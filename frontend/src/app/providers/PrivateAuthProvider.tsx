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
};

type AuthContextType = {
  session: PrivateSession | null;
  login: (credentials: LoginCredentials) => Promise<PrivateSession>;
  logout: () => Promise<boolean>;
};

const AuthContext = createContext<AuthContextType | null>(null);

async function readSession(response: Response): Promise<PrivateSession> {
  if (response.status === 401) {
    throw new Error("Organización, correo o contraseña incorrectos.");
  }
  if (!response.ok) {
    throw new Error("No se pudo iniciar sesión. Comprueba la configuración del entorno privado.");
  }
  const parsed = sessionSchema.safeParse(await response.json());
  if (!parsed.success || Date.parse(parsed.data.expires_at) <= Date.now()) {
    throw new Error("El servidor no devolvió una sesión válida.");
  }
  return parsed.data;
}

export function PrivateAuthProvider({ children }: PropsWithChildren) {
  // The bearer token must only exist in React memory. Never use localStorage,
  // sessionStorage, cookies, URL parameters or a React Query cache for it.
  const [session, setSession] = useState<PrivateSession | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!session) return;
    const remaining = Date.parse(session.expires_at) - Date.now();
    const timeout = window.setTimeout(() => {
      setSession(null);
      queryClient.clear();
    }, Math.max(0, Math.min(remaining, 2147483647)));
    return () => window.clearTimeout(timeout);
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

  const value = useMemo(() => ({ session, login, logout }), [session, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function usePrivateAuth(): AuthContextType {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("PrivateAuthProvider is required");
  return auth;
}
