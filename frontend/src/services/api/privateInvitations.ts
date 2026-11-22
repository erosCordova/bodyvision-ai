import { z } from "zod";
import { secureRequest } from "./privateRequest";

const role = z.enum(["specialist", "member"]);
const invitationRowSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  display_name: z.string(),
  role,
  created_at: z.string(),
  expires_at: z.string(),
  status: z.enum(["pending", "expired", "accepted", "revoked"]),
});
const invitationPageSchema = z.object({
  items: z.array(invitationRowSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
const createdSchema = z.object({
  id: z.string().uuid(),
  token: z.string().length(43),
  expires_at: z.string(),
  role,
});
const acceptedSchema = z.object({
  user_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  role,
});
const revokedSchema = z.object({ status: z.literal("revoked") });

export type PrivateInvitation = z.infer<typeof invitationRowSchema>;
export type InvitationCreated = z.infer<typeof createdSchema>;
export type InvitationCreate = {
  email: string;
  display_name: string;
  role: z.infer<typeof role>;
  administrator_password: string;
};

export function privateInvitationAdminApi(token: string) {
  return {
    list: async (offset = 0) => invitationPageSchema.parse(await secureRequest(
      token, `/invitations?limit=20&offset=${offset}`,
    )),
    create: async (data: InvitationCreate) => createdSchema.parse(await secureRequest(
      token, "/invitations", { method: "POST", body: JSON.stringify(data) },
    )),
    revoke: async (id: string) => revokedSchema.parse(await secureRequest(
      token, `/invitations/${encodeURIComponent(id)}/revoke`, { method: "POST" },
    )),
  };
}

/** An invitation is a capability secret submitted in the request BODY only.
 * This endpoint does not carry cookies or bearer tokens and never signs in.
 */
export async function acceptPrivateInvitation(input: {
  token: string;
  password: string;
}) {
  const response = await fetch("/api/v1/auth/invitations/accept", {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 404
      ? "La invitación ya no es válida o venció. Solicita otra al administrador."
      : "No se pudo completar la invitación en el servidor de pruebas.");
  }
  return acceptedSchema.parse(await response.json());
}
