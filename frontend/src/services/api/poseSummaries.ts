import { z } from "zod";
import { invalidatePrivateSession } from "./sessionInvalidation";

export const poseSummarySchema = z.object({
  id: z.string().uuid(), profile_id: z.string().uuid(), created_by: z.string().uuid(),
  created_at: z.string(), model_revision: z.string(), algorithm_revision: z.string(),
  detected: z.boolean(), threshold: z.number(), visible_points: z.number().int(),
  core_visible: z.number().int(),
  quality_state: z.enum(["not-detected", "insufficient", "caution", "reviewable"]),
  capture_passed: z.boolean(), summary_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  origin: z.literal("client_reported_browser"), data_type: z.literal("DERIVADO"),
  synthetic: z.literal(true),
});
const page = z.object({ items: z.array(poseSummarySchema), total: z.number().int(),
  limit: z.number().int(), offset: z.number().int() });
export type PoseSummary = z.infer<typeof poseSummarySchema>;
export type PoseSummaryDraft = Pick<PoseSummary,
  "model_revision" | "detected" | "threshold" | "visible_points" | "core_visible" |
  "quality_state" | "capture_passed">;

export function poseSummariesApi(token: string, profile: string) {
  const root = `/api/v1/profiles/${profile}/pose-summaries`;
  async function request(suffix: string, init: RequestInit = {}, signal?: AbortSignal) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal?.aborted) cancel();
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = window.setTimeout(cancel, 7000);
    try {
      const response = await fetch(root + suffix, { ...init, signal: controller.signal, cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers } });
      if (response.status === 401) invalidatePrivateSession(token);
      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { code?: string };
        const messages: Record<string, string> = {
          POSE_CONSENT_REQUIRED: "Registra aceptaciones vigentes de pose y conservación en el expediente.",
          POSE_SUMMARY_ERASED: "Este envío fue eliminado; ejecuta una nueva detección para guardar otro resultado.",
          FORBIDDEN: "No tienes permiso para modificar estos resúmenes.",
          NOT_FOUND: "El expediente o resumen no está disponible.",
          SESSION_EXPIRED: "La sesión ha caducado.",
          CONFLICT: "Este envío ya se usó con datos distintos.",
        };
        throw new Error(messages[error.code ?? ""] ?? "No se pudo completar la operación de pose.");
      }
      return response.status === 204 ? null : await response.json() as unknown;
    } finally {
      window.clearTimeout(timer); signal?.removeEventListener("abort", cancel);
    }
  }
  return {
    list: async (offset = 0, signal?: AbortSignal) => page.parse(await request(`?limit=20&offset=${offset}`, {}, signal)),
    save: async (value: PoseSummaryDraft, key: string) => poseSummarySchema.parse(await request("", {
      method: "POST", headers: { "Idempotency-Key": key },
      body: JSON.stringify({ model_revision: value.model_revision, detected: value.detected,
        threshold: value.threshold, visible_points: value.visible_points, core_visible: value.core_visible,
        quality_state: value.quality_state, capture_passed: value.capture_passed, synthetic_confirmed: true }),
    })),
    remove: async (id: string) => { await request(`/${id}`, { method: "DELETE" }); },
  };
}
