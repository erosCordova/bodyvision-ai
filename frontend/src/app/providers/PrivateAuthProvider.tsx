import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  invalidatePrivateSession, onPrivateSessionInvalidated,
  registerPrivateSessionRefresh, tryRefreshPrivateSession,
} from "../../services/api/sessionInvalidation";
import {
  cookieAccessRequest, parseCookieAccess, privateCookieAuthEnabled, refreshCookieOnce,
  waitForPendingCookieRefresh,
} from "../../services/api/cookieSession";
import { discardStagedCapture } from "../../features/capture/captureHandoff";
import { usePrivateSessionIdle } from "./usePrivateSessionIdle";

/**
 * This switch is deliberately impossible in a production Vite build.
 * The protected API is opt-in in local/test only, and has no public accounts.
 */
export function privateAuthEnabled(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_ENABLE_PRIVATE_AUTH === "true";
}

export function sandboxAuthEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_SANDBOX_AUTH === "true";
}

export function sessionRequired(): boolean {
  return privateAuthEnabled() || sandboxAuthEnabled();
}

const sessionSchema = z.object({
  token: z.string().min(40),
  organization_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: z.enum(["administrator", "specialist", "member", "privacy_officer"]),
  expires_at: z.string().datetime({ offset: true }),
  kind: z.literal("cookie").optional(),
});
export type PrivateSession = z.infer<typeof sessionSchema>;
export type LoginCredentials = {
  organization_id: string;
  email: string;
  password: string;
  mfa_code?: string;
};

type EnrollmentConfirmation = LoginCredentials & { code: string };
type RecoveryCredentials = LoginCredentials & { recovery_code: string };

export class PrivateAuthError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "PrivateAuthError";
  }
}

type AuthContextType = {
  session: PrivateSession | null;
  restoring: boolean;
  idleExpired: boolean;
  idleWarning: boolean;
  continueWorking: () => void;
  login: (credentials: LoginCredentials) => Promise<PrivateSession>;
  beginMfaEnrollment: (credentials: LoginCredentials) => Promise<string>;
  confirmMfaEnrollment: (credentials: EnrollmentConfirmation) => Promise<string[]>;
  recoverMfaFactor: (credentials: RecoveryCredentials) => Promise<string>;
  logout: () => Promise<boolean>;
};

const AuthContext = createContext<AuthContextType | null>(null);

async function authError(response: Response): Promise<never> {
  const body: unknown = await response.json().catch(() => null);
  const result = z.object({ code: z.string() }).safeParse(body);
  const code = result.success ? result.data.code : response.status === 401 ? "INVALID_CREDENTIALS" : "AUTH_ERROR";
  const messages: Record<string, string> = {
    INVALID_CREDENTIALS: "Organización, correo o contraseña incorrectos.",
    MFA_SETUP_REQUIRED: "Configura la verificación de dos factores para ingresar.",
    MFA_CODE_REQUIRED: "Introduce el código de tu aplicación autenticadora.",
    MFA_CODE_INVALID: "El código es inválido, ya se utilizó o ha caducado.",
    MFA_ALREADY_ENABLED: "La verificación ya está configurada en esta cuenta.",
    LOGIN_RATE_LIMITED: "Demasiados intentos. Inténtalo de nuevo en 15 minutos.",
  };
  throw new PrivateAuthError(
    code,
    messages[code] ?? "No fue posible completar la verificación del acceso privado.",
  );
}

function validateSession(body: unknown): PrivateSession {
  const parsed = sessionSchema.safeParse(body);
  if (!parsed.success || Date.parse(parsed.data.expires_at) <= Date.now()) {
    throw new Error("El servidor no devolvió una sesión válida.");
  }
  return parsed.data;
}

export function PrivateAuthProvider({ children }: PropsWithChildren) {
  // The bearer token must only exist in React memory. Never use localStorage,
  // sessionStorage, cookies, URL parameters or a React Query cache for it.
  const [session, setSession] = useState<PrivateSession | null>(null);
  const [restoring, setRestoring] = useState(() => privateCookieAuthEnabled());
  const [idleExpired, setIdleExpired] = useState(false);
  const [idleWarning, setIdleWarning] = useState(false);
  const activeSession = useRef<PrivateSession | null>(null);
  const epoch = useRef(0);
  // Bounded predecessors from this login only. A delayed 401 may arrive after
  // another request already rotated the cookie and replaced the access JWT.
  const retiredAccessTokens = useRef(new Set<string>());
  const queryClient = useQueryClient();

  const setActive = useCallback((value: PrivateSession | null) => {
    activeSession.current = value;
    setSession(value);
  }, []);

  // Reopen an HttpOnly cookie session only in explicitly opt-in local/test.
  // Its access JWT is re-issued into RAM; none of it enters localStorage.
  useEffect(() => {
    if (!privateCookieAuthEnabled()) return;
    const ticket = ++epoch.current;
    void refreshCookieOnce().then(async response => {
      if (!response.ok) return;
      const verified = parseCookieAccess(await response.clone().json());
      if (epoch.current === ticket) setActive(verified);
    }).catch(() => {
      // An absent, expired, or rejected refresh cookie simply leaves login visible.
    }).finally(() => {
      if (epoch.current === ticket) setRestoring(false);
    });
    return () => { epoch.current += 1; };
  }, [setActive]);

  const refreshSession = useCallback(async (token: string): Promise<string | null> => {
    const prior = activeSession.current;
    if (!privateCookieAuthEnabled() || prior?.kind !== "cookie")
      return null;
    if (prior.token !== token) {
      return retiredAccessTokens.current.has(token)
        && Date.parse(prior.expires_at) > Date.now() ? prior.token : null;
    }
    const ticket = epoch.current;
    try {
      const response = await refreshCookieOnce();
      if (!response.ok) return null;
      const replacement = parseCookieAccess(await response.clone().json());
      // Do not silently switch users/roles/organizations in an existing cache.
      if (
        replacement.user_id !== prior.user_id
        || replacement.organization_id !== prior.organization_id
        || replacement.role !== prior.role
      ) return null;
      if (ticket !== epoch.current || activeSession.current?.token !== token) return null;
      retiredAccessTokens.current.add(token);
      if (retiredAccessTokens.current.size > 16) {
        retiredAccessTokens.current.delete(retiredAccessTokens.current.values().next().value!);
      }
      setActive(replacement);
      return replacement.token;
    } catch {
      return null;
    }
  }, [setActive]);

  useEffect(() => {
    if (!privateCookieAuthEnabled()) return;
    return registerPrivateSessionRefresh(refreshSession);
  }, [refreshSession]);

  useEffect(() => {
    if (!session) return;
    const unsubscribe = onPrivateSessionInvalidated(token => {
      // Responses from an old token must never destroy a newer session.
      if (activeSession.current?.token !== token) return;
      epoch.current += 1;
      retiredAccessTokens.current.clear();
      discardStagedCapture();
      setActive(null);
      setRestoring(false);
      void queryClient.cancelQueries();
      queryClient.clear();
    });
    const remaining = Date.parse(session.expires_at) - Date.now();
    const cookieFlow = session.kind === "cookie" && privateCookieAuthEnabled();
    const timeout = window.setTimeout(() => {
      if (cookieFlow) {
        void tryRefreshPrivateSession(session.token).then(next => {
          if (!next) invalidatePrivateSession(session.token);
        });
      } else {
        invalidatePrivateSession(session.token);
      }
    }, Math.max(0, Math.min(remaining - (cookieFlow ? 30000 : 0), 2147483647)));
    return () => { window.clearTimeout(timeout); unsubscribe(); };
  }, [session, queryClient, setActive]);

  const login = useCallback(
    async (credentials: LoginCredentials): Promise<PrivateSession> => {
      if (!sessionRequired()) {
        throw new Error("El acceso privado no está disponible en la demostración.");
      }
      const ticket = ++epoch.current;
      retiredAccessTokens.current.clear();
      const cookieFlow = privateCookieAuthEnabled();
      const response = cookieFlow
        ? await cookieAccessRequest("login", credentials)
        : await fetch("/api/v1/auth/login", {
            method: "POST",
            cache: "no-store",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(credentials),
          });
      if (!response.ok) return authError(response);
      const verified = cookieFlow
        ? parseCookieAccess(await response.json())
        : validateSession(await response.json());
      if (ticket !== epoch.current) throw new Error("La solicitud de acceso quedó obsoleta.");
      discardStagedCapture();
      await queryClient.cancelQueries();
      queryClient.clear();
      setIdleExpired(false);
      setIdleWarning(false);
      setActive(verified);
      setRestoring(false);
      return verified;
    },
    [queryClient, setActive],
  );

  const beginMfaEnrollment = useCallback(async (credentials: LoginCredentials): Promise<string> => {
    if (!privateAuthEnabled()) throw new Error("Acceso privado no disponible.");
    const response = await fetch("/api/v1/auth/mfa/enrollment", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organization_id: credentials.organization_id,
        email: credentials.email,
        password: credentials.password,
      }),
    });
    if (!response.ok) return authError(response);
    const parsed = z.object({
      status: z.literal("pending"),
      otpauth_uri: z.string().min(20),
    }).safeParse(await response.json());
    if (!parsed.success) throw new Error("No se recibió una configuración válida.");
    return parsed.data.otpauth_uri;
  }, []);

  const confirmMfaEnrollment = useCallback(async (
    credentials: EnrollmentConfirmation,
  ): Promise<string[]> => {
    if (!privateAuthEnabled()) throw new Error("Acceso privado no disponible.");
    const response = await fetch("/api/v1/auth/mfa/confirm", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });
    if (!response.ok) return authError(response);
    const body: unknown = await response.json();
    const parsed = z.object({
      recovery_codes: z.array(z.string().length(32)).length(8),
    }).safeParse(body);
    if (!parsed.success) throw new Error("No se recibieron los códigos de recuperación.");
    const verified = validateSession(body);
    epoch.current += 1;
    retiredAccessTokens.current.clear();
    discardStagedCapture();
    await queryClient.cancelQueries();
    queryClient.clear();
    // MFA enrollment confirmation still produces a legacy opaque session.
    // Do not pretend that this response sets a refresh cookie.
    setIdleExpired(false);
    setIdleWarning(false);
    setActive(verified);
    setRestoring(false);
    return parsed.data.recovery_codes;
  }, [queryClient, setActive]);

  const recoverMfaFactor = useCallback(async (
    credentials: RecoveryCredentials,
  ): Promise<string> => {
    if (!privateAuthEnabled()) throw new Error("Acceso privado no disponible.");
    const response = await fetch("/api/v1/auth/mfa/recover", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });
    if (!response.ok) return authError(response);
    const parsed = z.object({
      status: z.literal("pending"),
      otpauth_uri: z.string().min(20),
    }).safeParse(await response.json());
    if (!parsed.success) throw new Error("No se recibió la nueva configuración.");
    return parsed.data.otpauth_uri;
  }, []);

  const logout = useCallback(async (): Promise<boolean> => {
    const prior = activeSession.current;
    epoch.current += 1;
    retiredAccessTokens.current.clear();
    discardStagedCapture();
    setActive(null);
    setRestoring(false);
    await queryClient.cancelQueries();
    queryClient.clear();
    if (!prior) return true;
    try {
      // A one-time refresh cookie may be rotating concurrently with logout.
      // Let that response set the successor cookie BEFORE revoking it remotely.
      if (prior.kind === "cookie") await waitForPendingCookieRefresh();
      const response = prior.kind === "cookie"
        ? await cookieAccessRequest("logout")
        : await fetch("/api/v1/auth/logout", {
            method: "POST",
            cache: "no-store",
            credentials: "same-origin",
            headers: { Authorization: `Bearer ${prior.token}` },
          });
      return response.status === 204;
    } catch {
      // Local state is cleared even if the network is unavailable. The server
      // session may remain valid until expiration; caller must show a warning.
      return false;
    }
  }, [queryClient, setActive]);

  const onIdle = useCallback(() => {
    setIdleWarning(false);
    setIdleExpired(true);
    void logout();
  }, [logout]);

  const continueWorking = usePrivateSessionIdle(session, onIdle, setIdleWarning);

  const value = useMemo(
    () => ({ session, restoring, idleExpired, idleWarning, continueWorking, login, beginMfaEnrollment, confirmMfaEnrollment, recoverMfaFactor, logout }),
    [session, restoring, idleExpired, idleWarning, continueWorking, login, beginMfaEnrollment, confirmMfaEnrollment, recoverMfaFactor, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function usePrivateAuth(): AuthContextType {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("PrivateAuthProvider is required");
  return auth;
}
