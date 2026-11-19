import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { onPrivateSessionInvalidated } from "../../services/api/sessionInvalidation";

/**
 * This switch is deliberately impossible in a production Vite build.
 * The protected API is opt-in in local/test only, and has no public accounts.
 */
export function privateAuthEnabled(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_ENABLE_PRIVATE_AUTH === "true";
}

const sessionSchema = z.object({
  token: z.string().min(40),
  organization_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: z.enum(["administrator", "specialist", "member"]),
  expires_at: z.string().datetime({ offset: true }),
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

async function readSession(response: Response): Promise<PrivateSession> {
  if (!response.ok) return authError(response);
  return validateSession(await response.json());
}

export function PrivateAuthProvider({ children }: PropsWithChildren) {
  // The bearer token must only exist in React memory. Never use localStorage,
  // sessionStorage, cookies, URL parameters or a React Query cache for it.
  const [session, setSession] = useState<PrivateSession | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!session) return;
    const unsubscribe = onPrivateSessionInvalidated(token => {
      // A late response from an older request must not discard a newer login.
      if (token !== session.token) return;
      setSession(null);
      void queryClient.cancelQueries();
      queryClient.clear();
    });
    const remaining = Date.parse(session.expires_at) - Date.now();
    const timeout = window.setTimeout(() => {
      setSession(null);
      queryClient.clear();
    }, Math.max(0, Math.min(remaining, 2147483647)));
    return () => { window.clearTimeout(timeout); unsubscribe(); };
  }, [session, queryClient]);

  const login = useCallback(
    async (credentials: LoginCredentials): Promise<PrivateSession> => {
      if (!privateAuthEnabled()) {
        throw new Error("El acceso privado no está disponible en la demostración.");
      }
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });
      const verified = await readSession(response);
      await queryClient.cancelQueries();
      queryClient.clear();
      setSession(verified);
      return verified;
    },
    [queryClient],
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
    await queryClient.cancelQueries();
    queryClient.clear();
    setSession(verified);
    return parsed.data.recovery_codes;
  }, [queryClient]);

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
    const prior = session;
    setSession(null);
    await queryClient.cancelQueries();
    queryClient.clear();
    if (!prior) return true;
    try {
      const response = await fetch("/api/v1/auth/logout", {
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
  }, [queryClient, session]);

  const value = useMemo(
    () => ({ session, login, beginMfaEnrollment, confirmMfaEnrollment, recoverMfaFactor, logout }),
    [session, login, beginMfaEnrollment, confirmMfaEnrollment, recoverMfaFactor, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function usePrivateAuth(): AuthContextType {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("PrivateAuthProvider is required");
  return auth;
}
