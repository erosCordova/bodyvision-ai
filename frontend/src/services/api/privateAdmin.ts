import { z } from "zod";

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
  if (response.status === 401) throw new Error("La sesión ha caducado. Inicia sesión de nuevo.");
  if (response.status === 403) throw new Error("No tienes permisos de administrador.");
  if (response.status === 409) throw new Error("Ya existe una cuenta con ese correo.");
  if (!response.ok) {
    throw new Error("No se pudo completar la operación. Comprueba el servidor de pruebas.");
  }
  return response.json();
}

export function privateAdminApi(token: string) {
  return {
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
