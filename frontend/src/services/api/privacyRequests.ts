import { z } from "zod";
import { dataRequest } from "./records";

const kind = z.enum(["access", "rectification", "cancellation", "opposition", "export"]);
export type PrivacyKind = z.infer<typeof kind>;
export const privacyRequestSchema = z.object({
  id: z.string().uuid(),
  profile_id: z.string().uuid(),
  request_type: kind,
  status: z.enum(["received", "in_review", "rejected"]),
  requested_by: z.string().uuid(),
  received_at: z.string().datetime({ offset: true }),
  review_target_at: z.string().datetime({ offset: true }),
  review_started_at: z.string().datetime({ offset: true }).nullable(),
  reviewed_by: z.string().uuid().nullable(),
  profile_code: z.string().min(1),
  review_overdue: z.boolean(),
  can_review: z.boolean(),
  rejected_at: z.string().datetime({ offset: true }).nullable().optional(),
  rejected_by: z.string().uuid().nullable().optional(),
  rejection_reason: z.enum(["invalid_synthetic_request", "withdrawn_by_requester", "duplicate_review"]).nullable().optional(),
}).strict();
export type PrivacyRequest = z.infer<typeof privacyRequestSchema>;
const page = z.object({
  items: z.array(privacyRequestSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

export type RejectionReason = "invalid_synthetic_request" | "withdrawn_by_requester" | "duplicate_review";
export const rejectionLabels: Record<RejectionReason, string> = {
  invalid_synthetic_request: "Solicitud ficticia inválida",
  withdrawn_by_requester: "Retiro comunicado por el solicitante ficticio",
  duplicate_review: "Revisión duplicada",
};

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
      status: "all" | "received" | "in_review" | "rejected" = "all",
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
    reject: (requestId: string, reason: RejectionReason) =>
      post("/privacy-requests/" + requestId + "/reject", { reason, synthetic_confirmed: true }),
  };
}
