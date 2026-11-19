import { z } from "zod";
import { invalidatePrivateSession } from "./sessionInvalidation";

const auditEventSchema = z.object({
  id: z.string().uuid(),
  actor_id: z.string().uuid().nullable(),
  action: z.string(),
  resource_type: z.string(),
  resource_id: z.string().uuid().nullable(),
  outcome: z.enum(["allowed", "denied", "error"]),
  happened_at: z.string(),
});

const createdUserSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  display_name: z.string(),
  email: z.string(),
  role: z.enum(["specialist", "member"]),
  status: z.literal("active"),
});

const permissionChangeSchema = z.object({
  profile_id: z.string().uuid(),
  user_id: z.string().uuid(),
  status: z.enum(["granted", "revoked"]),
});
export type PermissionGrant = {
  profile_id: string;
  user_id: string;
  access_level: "read" | "write" | "manage";
};
export type PermissionRevoke = Pick<PermissionGrant, "profile_id" | "user_id">;
export type PermissionChange = z.infer<typeof permissionChangeSchema>;

export type AuditEvent = z.infer<typeof auditEventSchema>;
export type NewTestAccount = {
  display_name: string;
  email: string;
  password: string;
  role: "specialist" | "member";
};
export type CreatedTestAccount = z.infer<typeof createdUserSchema>;

const passwordResetSchema = z.object({
  user_id: z.string().uuid(),
  status: z.literal("reset"),
  revoked_sessions: z.number().int().nonnegative(),
});
export type PasswordResetInput = {
  administrator_password: string;
  new_password: string;
};

async function secureRequest(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  if (token.length < 40) throw new Error("Se requiere una sesión de pruebas.");
  const response = await fetch(`/api/v1/auth${path}`, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (response.status === 401) {
    invalidatePrivateSession(token);
    throw new Error("La sesión ha caducado. Inicia sesión de nuevo.");
  }
  if (response.status === 403 || response.status === 429) {
    const body = await response.clone().json().catch(() => ({})) as { code?: string };
    if (body.code === "RESET_REAUTH_REQUIRED") throw new Error("Confirma la contraseña del administrador.");
    if (body.code === "RESET_RATE_LIMITED") throw new Error("Demasiados intentos. Espera 15 minutos.");
  }
  if (response.status === 403) throw new Error("No tienes permisos de administrador.");
  if (response.status === 409) throw new Error("Ya existe una cuenta con ese correo.");
  if (!response.ok) {
    throw new Error("No se pudo completar la operación. Comprueba el servidor de pruebas.");
  }
  return response.json();
}

export function privateAdminApi(token: string) {
  return {
    resetPassword: async (userId: string, input: PasswordResetInput) =>
      passwordResetSchema.parse(await secureRequest(token, `/users/${userId}/reset-password`, {
        method: "POST", body: JSON.stringify(input),
      })),
    createUser: async (account: NewTestAccount): Promise<CreatedTestAccount> => {
      const body = createdUserSchema.parse(
        await secureRequest(token, "/users", {
          method: "POST",
          body: JSON.stringify(account),
        }),
      );
      return body;
    },
    audit: async (): Promise<AuditEvent[]> =>
      z.array(auditEventSchema).parse(await secureRequest(token, "/audit?limit=30")),
    grantAccess: async (grant: PermissionGrant): Promise<PermissionChange> =>
      permissionChangeSchema.parse(
        await secureRequest(token, "/profile-access/grant", {
          method: "POST", body: JSON.stringify(grant),
        }),
      ),
    revokeAccess: async (data: PermissionRevoke): Promise<PermissionChange> =>
      permissionChangeSchema.parse(
        await secureRequest(token, "/profile-access/revoke", {
          method: "POST", body: JSON.stringify(data),
        }),
      ),
  };
}
