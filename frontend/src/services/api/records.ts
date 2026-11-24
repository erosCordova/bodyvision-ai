import { z } from "zod";
import { comparisonDownloadSchema } from "../../features/analytics/serverComparisonDownload";
import { longitudinalDownloadSchema, type ExportDateRange } from "../../features/analytics/serverLongitudinalExport";
import { ApiError } from "./client";
import { withPrivateSession } from "./privateSessionRequest";

export const profileSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  display_code: z.string(),
  display_name: z.string().nullable(),
  birth_year: z.number(),
  sex: z.string().nullable(),
  status: z.enum(["active", "restricted", "archived"]),
  created_at: z.string(),
  synthetic: z.boolean(),
});
export type Profile = z.infer<typeof profileSchema>;
export const metricSchema = z.object({
  code: z.string(),
  label: z.string(),
  unit: z.string(),
  min_value: z.number(),
  max_value: z.number(),
  allowed_methods: z.array(z.string()),
  precision: z.number(),
  instructions: z.string(),
});
export type Metric = z.infer<typeof metricSchema>;
export const measurementSchema = z.object({
  id: z.string().uuid(),
  profile_id: z.string().uuid(),
  metric_code: z.string(),
  value: z.number(),
  unit: z.string(),
  measured_at: z.string(),
  method: z.enum(["manual", "device"]),
  instrument: z.string().nullable(),
  notes: z.string().nullable(),
  created_by: z.string().uuid(),
  responsible: z.string(),
  created_at: z.string(),
  supersedes_id: z.string().nullable(),
  correction_reason: z.string().nullable(),
  is_current: z.boolean(),
  outlier_confirmed: z.boolean(),
  data_type: z.literal("OBSERVADO"),
});
export type Measurement = z.infer<typeof measurementSchema>;
export const scenarioSchema = z.object({
  id: z.string().uuid(),
  profile_id: z.string().uuid(),
  series_id: z.string().uuid(),
  version: z.number().int().min(1),
  prior_version_id: z.string().uuid().nullable(),
  reference_kg: z.number(),
  variation_percent: z.number().int(),
  stature_cm: z.number().int(),
  simulated_kg: z.number(),
  model_revision: z.string(),
  algorithm_revision: z.string(),
  revision_note: z.string().nullable(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  data_type: z.literal("SIMULADO"),
});
export type SimulationScenario = z.infer<typeof scenarioSchema>;

const pageOf = <T extends z.ZodType>(schema: T) =>
  z.object({
    items: z.array(schema),
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
  });
const scenarioPageSchema = pageOf(scenarioSchema).extend({
  // The demo has no PostgreSQL table; older mocks may omit the field.
  snapshot_at: z.string().datetime({ offset: true }).nullable().optional(),
});
const derivedSchema = z.object({
  metric_code: z.string(),
  label: z.string(),
  value: z.number().nullable(),
  unit: z.string(),
  formula: z.string(),
  source_measurement_ids: z.array(z.string()),
  as_of: z.string(),
  reason: z.string().nullable(),
  data_type: z.literal("DERIVADO"),
});
export type Derived = z.infer<typeof derivedSchema>;
const summarySchema = z.object({
  active_profiles: z.number(),
  measurements_30d: z.number(),
  corrections: z.number(),
  synthetic: z.boolean(),
  recent_measurements: z.array(
    z.object({
      id: z.string(),
      metric_code: z.string(),
      metric_label: z.string(),
      value: z.coerce.number(),
      unit: z.string(),
      measured_at: z.string(),
      method: z.string(),
      profile_id: z.string(),
      display_code: z.string(),
      responsible: z.string(),
      data_type: z.literal("OBSERVADO"),
    }),
  ),
});
export const workspacesSchema = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string() })),
  synthetic: z.boolean(),
  notice: z.string(),
  read_only: z.boolean(),
});

export async function dataRequest<T>(
  workspace: string,
  path: string,
  schema: z.ZodType<T>,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const correlationId = crypto.randomUUID();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    import.meta.env.VITE_DEPLOYMENT_MODE === "demo" ? 90000 : 7000,
  );
  try {
    const send = (bearer?: string) => fetch(`/api/v1${path}`, {
      ...options,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Correlation-ID": correlationId,
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : { "X-Workspace-ID": workspace }),
        ...options.headers,
      },
    });
    const response = token
      ? await withPrivateSession(token, send, controller.signal)
      : await send();
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError(
        response.headers.get("X-Correlation-ID") ?? correlationId,
        typeof body.code === "string" ? body.code : "REQUEST_FAILED",
        typeof body.message === "string"
          ? body.message
          : "No se pudo completar la operación.",
      );
    }
    return schema.parse(await response.json());
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      correlationId,
      "CONNECTION_ERROR",
      "No se pudo conectar con el servicio.",
    );
  } finally {
    clearTimeout(timeout);
  }
}
export function recordsApi(workspace: string, token?: string) {
  const get = <T>(path: string, schema: z.ZodType<T>) =>
    dataRequest(workspace, path, schema, {}, token);
  const write = <T>(
    path: string,
    method: string,
    body: unknown,
    schema: z.ZodType<T>,
    key?: string,
  ) =>
    dataRequest(workspace, path, schema, {
      method,
      body: JSON.stringify(body),
      headers: key ? { "Idempotency-Key": key } : {},
    }, token);
  return {
    longitudinalReport: (id: string, metricCode: string, period: "30d" | "90d" | "1a" | "all", range?: ExportDateRange) =>
      write(`/profiles/${id}/reports/longitudinal`, "POST",
        range ? { metric_code: metricCode, period: "custom", ...range }
          : { metric_code: metricCode, period }, longitudinalDownloadSchema),
    comparisonReport: (id: string, initialId: string, finalId: string) =>
      write(`/profiles/${id}/reports/comparison`, "POST",
        { initial_id: initialId, final_id: finalId }, comparisonDownloadSchema),
    workspaces: () => get("/workspaces", workspacesSchema),
    summary: () => get("/dashboard/summary", summarySchema),
    profiles: (search = "", offset = 0) =>
      get(
        `/profiles?search=${encodeURIComponent(search)}&offset=${offset}&limit=12`,
        pageOf(profileSchema),
      ),
    profile: (id: string) => get(`/profiles/${id}`, profileSchema),
    createProfile: (body: unknown) =>
      write("/profiles", "POST", body, profileSchema),
    updateProfile: (id: string, body: unknown) =>
      write(`/profiles/${id}`, "PATCH", body, profileSchema),
    archive: (id: string) =>
      write(`/profiles/${id}/archive`, "POST", {}, profileSchema),
    catalog: () => get("/metrics/catalog", z.array(metricSchema)),
    measurements: (id: string, metric = "", offset = 0) =>
      get(
        `/profiles/${id}/measurements?limit=20&offset=${offset}${metric ? `&metric_code=${metric}` : ""}`,
        pageOf(measurementSchema),
      ),
    save: (id: string, body: unknown, key: string, correction?: string) =>
      write(
        correction
          ? `/measurements/${correction}`
          : `/profiles/${id}/measurements`,
        correction ? "PATCH" : "POST",
        body,
        measurementSchema,
        key,
      ),
    versions: (id: string) =>
      get(`/measurements/${id}/versions`, z.array(measurementSchema)),
    versionsPage: (id: string, offset = 0) =>
      get(`/measurements/${id}/versions/page?limit=20&offset=${offset}`,
        pageOf(measurementSchema)),
    derived: (id: string) =>
      get(`/profiles/${id}/analytics/derived`, z.array(derivedSchema)),
    series: (id: string, metric: string, period: string, range?: ExportDateRange) => {
      const query = new URLSearchParams({ metric_code: metric, period });
      if (range) {
        query.set("start_date", range.start_date);
        query.set("end_date", range.end_date);
      }
      return get(`/profiles/${id}/analytics/series?${query.toString()}`, z.array(measurementSchema));
    },
    scenarios: (profileId: string, offset = 0, snapshotAt?: string) =>
      get(`/profiles/${profileId}/scenarios?limit=20&offset=${offset}${snapshotAt
        ? `&snapshot_at=${encodeURIComponent(snapshotAt)}` : ""}`,
        scenarioPageSchema),
    scenarioVersions: (profileId: string, scenarioId: string) =>
      get(`/profiles/${profileId}/scenarios/${scenarioId}/versions`,
        z.array(scenarioSchema)),
    saveScenario: (profileId: string, body: unknown, key: string) =>
      write(`/profiles/${profileId}/scenarios`, "POST", body, scenarioSchema, key),
  };
}
