import { z } from "zod";
import { dataRequest } from "./records";

const purposeSchema = z.enum(["capture", "pose", "report", "storage"]);
export type ConsentPurpose = z.infer<typeof purposeSchema>;
export const consentHistorySchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    purpose: purposeSchema,
    version: z.string(),
    cycle: z.number().int().positive(),
    status: z.enum(["pending", "accepted", "revoked"]),
    accepted_at: z.string().nullable(),
    revoked_at: z.string().nullable(),
    expires_at: z.string().nullable(),
    recorded_by: z.string().uuid(),
    revoked_by: z.string().uuid().nullable(),
    effective: z.boolean(),
  })),
  can_record: z.boolean(),
  can_revoke: z.boolean(),
  policy_version: z.literal("bv-synthetic-v1"),
  checked_at: z.string(),
});
export type ConsentHistory = z.infer<typeof consentHistorySchema>;

export function consentsApi(organization: string, token: string, profileId: string) {
  const path = `/auth/profiles/${profileId}/consents`;
  const request = (suffix = "", body?: unknown) => dataRequest(
    organization, path + suffix, consentHistorySchema,
    body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }, token,
  );
  return {
    history: () => request(),
    accept: (purpose: ConsentPurpose) => request("", {
      purpose, version: "bv-synthetic-v1", confirmed: true,
    }),
    revoke: (id: string) => request(`/${id}/revoke`, {}),
  };
}
