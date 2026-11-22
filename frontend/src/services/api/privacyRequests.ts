import { z } from "zod";
import { dataRequest } from "./records";

const kind = z.enum(["access", "rectification", "cancellation", "opposition", "export"]);
export type PrivacyKind = z.infer<typeof kind>;
export const privacyRequestSchema = z.object({
  id: z.string().uuid(),
  profile_id: z.string().uuid(),
  request_type: kind,
  status: z.enum(["received", "in_review"]),
  requested_by: z.string().uuid(),
  received_at: z.string().datetime({ offset: true }),
  review_target_at: z.string().datetime({ offset: true }),
  review_started_at: z.string().datetime({ offset: true }).nullable(),
  reviewed_by: z.string().uuid().nullable(),
  profile_code: z.string().min(1),
  review_overdue: z.boolean(),
}).strict();
export type PrivacyRequest = z.infer<typeof privacyRequestSchema>;
const page = z.object({
  items: z.array(privacyRequestSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

export const kindLabels: Record<PrivacyKind, string> = {
  access: "Acceso",
  rectification: "Rectificación",
  cancellation: "Cancelación",
  opposition: "Oposición",
  export: "Exportación",
};

export function privacyRequestsApi(workspace: string, token: string) {
  const get = (path: string) => dataRequest(workspace, path, page, {}, token);
  const post = (path: string, body: unknown) =>
    dataRequest(workspace, path, privacyRequestSchema, {
      method: "POST", body: JSON.stringify(body),
    }, token);
  return {
    listProfile: (profileId: string, offset = 0) =>
      get("/profiles/" + profileId + "/privacy-requests?limit=20&offset=" + offset),
    listQueue: (
      offset = 0,
      status: "all" | "received" | "in_review" = "all",
      overdueOnly = false,
    ) => {
      const query = new URLSearchParams({ limit: "20", offset: String(offset) });
      if (status !== "all") query.set("status", status);
      if (overdueOnly) query.set("overdue_only", "true");
      return get("/privacy-requests?" + query.toString());
    },
    submit: (profileId: string, requestType: PrivacyKind) =>
      post("/profiles/" + profileId + "/privacy-requests", {
        request_type: requestType, synthetic_confirmed: true,
      }),
    startReview: (requestId: string) => post("/privacy-requests/" + requestId + "/review", {}),
  };
}
