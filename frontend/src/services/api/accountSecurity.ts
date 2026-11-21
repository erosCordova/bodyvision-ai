import { z } from "zod";
import { secureRequest } from "./privateRequest";

const sessionsSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(), issued_at: z.string(), expires_at: z.string(), current: z.boolean(),
  })),
  total: z.number().int().nonnegative(), limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(), checked_at: z.string(),
});
const changeSchema = z.object({
  status: z.enum(["changed", "revoked"]), revoked_sessions: z.number().int().nonnegative(),
  current_revoked: z.boolean(),
});
const integritySchema = z.object({
  valid: z.boolean(), checked_events: z.number().int().nonnegative(),
  checkpoint_sequence: z.number().int().nonnegative(),
  checkpoint_hash: z.string().regex(/^[0-9a-f]{64}$/),
  first_invalid_sequence: z.number().int().positive().nullable(),
  checked_at: z.string(), algorithm: z.literal("sha256-chain-v1"),
});
export type OwnSessions = z.infer<typeof sessionsSchema>;
export type AuditIntegrity = z.infer<typeof integritySchema>;

export function accountSecurityApi(token: string) {
  return {
    sessions: async (offset = 0) => sessionsSchema.parse(await secureRequest(
      token, `/sessions?limit=20&offset=${offset}`,
    )),
    changePassword: async (current_password: string, new_password: string) => changeSchema.parse(
      await secureRequest(token, "/password", {
        method: "POST", body: JSON.stringify({ current_password, new_password }),
      }),
    ),
    revoke: async (sessionId: string | null, current_password: string) => changeSchema.parse(
      await secureRequest(token, sessionId ? `/sessions/${sessionId}/revoke` : "/sessions/revoke-all", {
        method: "POST", body: JSON.stringify({ current_password }),
      }),
    ),
    verifyAudit: async () => integritySchema.parse(await secureRequest(token, "/audit/verify", {
      method: "POST", body: "{}",
    })),
  };
}
