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
  };
}
