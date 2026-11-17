import { z } from "zod";

const liveSchema = z.object({
  status: z.literal("alive"),
  service: z.literal("bodyvision-api"),
  version: z.string(),
  phase: z.number(),
  environment: z.string(),
  checked_at: z.string().datetime(),
});
const readySchema = z.object({
  status: z.literal("ready"),
  database: z.literal("connected"),
  schema_revision: z.string(),
  checked_at: z.string().datetime(),
});
export type LiveStatus = z.infer<typeof liveSchema>;
export type ReadyStatus = z.infer<typeof readySchema>;

export class ApiError extends Error {
  constructor(
    public readonly correlationId: string,
    public readonly code: string,
    message = "No se pudo verificar el servicio.",
  ) {
    super(message);
  }
}

async function request<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const correlationId = crypto.randomUUID();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(`/api/v1${path}`, {
      signal: controller.signal,
      headers: { "X-Correlation-ID": correlationId },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new ApiError(
        response.headers.get("X-Correlation-ID") ?? correlationId,
        "SERVICE_UNAVAILABLE",
      );
    }
    return schema.parse(await response.json());
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(correlationId, "CONNECTION_ERROR");
  } finally {
    clearTimeout(timeout);
  }
}
export const api = {
  live: () => request("/health/live", liveSchema),
  ready: () => request("/health/ready", readySchema),
};
