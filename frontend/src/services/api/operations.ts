import { z } from "zod";
import { secureRequest } from "./privateRequest";

export const operationsSchema = z.object({
  scope: z.literal("current_organization_current_process"),
  checked_at: z.string().datetime({ offset: true }),
  uptime_seconds: z.number().int().nonnegative(),
  window_seconds: z.number().int().positive(),
  sample_limit: z.number().int().positive(),
  sample_count: z.number().int().nonnegative(),
  successes: z.number().int().nonnegative(),
  client_errors: z.number().int().nonnegative(),
  server_errors: z.number().int().nonnegative(),
  query_interruptions: z.number().int().nonnegative(),
  p95_ms: z.number().nonnegative().nullable(),
  retention: z.object({
    state: z.enum(["ready", "failed", "pending", "overdue", "disabled"]),
    checked_at: z.string().datetime({ offset: true }).nullable(),
  }),
  database: z.object({
    state: z.enum(["ready", "unavailable"]),
    checked_at: z.string().datetime({ offset: true }),
  }),
  alerts: z.array(z.enum([
    "server_failures", "query_interrupted", "slow_responses", "database_unavailable",
    "retention_failed", "retention_overdue",
  ])),
});
export type OperationsStatus = z.infer<typeof operationsSchema>;
export async function readOperations(token: string, signal: AbortSignal): Promise<OperationsStatus> {
  return operationsSchema.parse(await secureRequest(token, "/operations", { signal }));
}
