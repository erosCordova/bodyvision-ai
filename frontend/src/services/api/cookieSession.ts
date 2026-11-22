/** Opt-in local/test access JWT flow. The refresh secret is an HttpOnly cookie.
 * Access tokens exist in memory only. No data is saved to browser storage.
 */
import { z } from "zod";

export function privateCookieAuthEnabled(): boolean {
  return import.meta.env.DEV
    && import.meta.env.VITE_ENABLE_PRIVATE_AUTH === "true"
    && import.meta.env.VITE_PRIVATE_COOKIE_AUTH === "true";
}

const accessSchema = z.object({
  access_token: z.string().min(40),
  token_type: z.literal("Bearer"),
  expires_at: z.string().datetime({ offset: true }),
  organization_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: z.enum(["administrator", "specialist", "member"]),
});

export function parseCookieAccess(body: unknown) {
  const data = accessSchema.safeParse(body);
  if (!data.success || Date.parse(data.data.expires_at) <= Date.now()) {
    throw new Error("El servidor no devolvió un token de acceso válido.");
  }
  return {
    token: data.data.access_token,
    expires_at: data.data.expires_at,
    organization_id: data.data.organization_id,
    user_id: data.data.user_id,
    role: data.data.role,
    kind: "cookie" as const,
  };
}

type Action = "login" | "refresh" | "logout";

/** Browser sends the Origin header on same-origin POST; JS cannot set it. */
export async function cookieAccessRequest(
  action: Action,
  credentials?: {
    organization_id: string;
    email: string;
    password: string;
    mfa_code?: string;
  },
): Promise<Response> {
  if (!privateCookieAuthEnabled()) throw new Error("Acceso de pruebas deshabilitado.");
  if (action === "login" && !credentials) throw new Error("Faltan credenciales.");
  return fetch(`/api/v1/auth/access/${action}`, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      ...(action === "login" ? { "Content-Type": "application/json" } : {}),
    },
    ...(action === "login" ? { body: JSON.stringify(credentials) } : {}),
  });
}

// Reusing one refresh request avoids consuming the same one-time cookie twice
// under React StrictMode, multiple protected queries or parallel 401 replies.
let pendingRefresh: Promise<Response> | null = null;
export function refreshCookieOnce(): Promise<Response> {
  if (!pendingRefresh) {
    const task = cookieAccessRequest("refresh");
    pendingRefresh = task;
    void task.finally(() => {
      if (pendingRefresh === task) pendingRefresh = null;
    }).catch(() => {});
  }
  return pendingRefresh;
}
