/** Private, optional local/test encrypted archive. No production uploads. */
import { z } from "zod";
import { withPrivateSession } from "./privateSessionRequest";

const storedCapture = z.object({
  id: z.string().uuid(), profile_id: z.string().uuid(),
  created_by: z.string().uuid(), format: z.literal("image/png"),
  original_bytes: z.number().int().positive(), width: z.number().int().positive(),
  height: z.number().int().positive(), sha256_digest: z.string().length(64),
  created_at: z.string(), expires_at: z.string(),
  data_type: z.literal("SIMULADO"),
});
const listSchema = z.object({
  items: z.array(storedCapture), total: z.number().int().nonnegative(),
});
export type StoredCapture = z.infer<typeof storedCapture>;

async function scopedFetch(token: string, path: string, init: RequestInit = {}) {
  if (token.length < 40) throw new Error("Se requiere una sesión privada.");
  const response = await withPrivateSession(token, bearer => fetch("/api/v1" + path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: { Authorization: `Bearer ${bearer}`, ...init.headers },
  }), init.signal);
  if (response.status === 401) {
    throw new Error("Tu sesión expiró. Ingresa de nuevo.");
  }
  if (!response.ok) {
    const body = await response.clone().json().catch(() => null) as { code?: string } | null;
    const messages: Record<string, string> = {
      POSE_QUEUE_DISABLED: "El análisis en servidor requiere un trabajador privado configurado.",
      POSE_CONSENT_REQUIRED: "Registra el consentimiento ficticio vigente de pose.",
      CAPTURE_CONSENT_REQUIRED: "Registra aceptaciones ficticias de captura y conservación en el expediente.",
      CAPTURE_STORAGE_DISABLED: "El almacenamiento de prueba necesita una clave privada configurada en el servidor.",
      SYNTHETIC_CONFIRMATION_REQUIRED: "Debes confirmar que el archivo es ficticio.",
      INVALID_PNG: "El PNG no es compatible o contiene metadatos no permitidos.",
      CAPTURE_SIZE: "Archivo demasiado grande para este prototipo (máximo 256 KiB).",
      FORBIDDEN: "El expediente no permite esta operación.",
      NOT_FOUND: "Captura o expediente no disponible.",
    };
    throw new Error(messages[body?.code ?? ""] ?? "No se pudo procesar la captura ficticia.");
  }
  return response;
}

const serverPoseJob = z.object({
  id: z.string().uuid(), profile_id: z.string().uuid(), capture_id: z.string().uuid(),
  status: z.enum(["queued", "processing", "needs_review", "failed", "accepted", "rejected"]),
  attempts: z.number().int().min(0).max(3),
  result: z.object({
    detected: z.boolean(), visible_points: z.number().int().min(0).max(33),
    model_sha256: z.literal("59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a"),
    model_revision: z.literal("pose_landmarker_lite/float16/1"),
  }).strict().nullable(),
  error_code: z.string().nullable(),
  origin: z.literal("server_model"), synthetic: z.literal(true),
});
export type ServerPoseJob = z.infer<typeof serverPoseJob>;

export function serverPoseApi(token: string, profileId: string, captureId: string) {
  const root = `/profiles/${profileId}/captures/${captureId}/server-pose`;
  const post = async (path: string, body: object) => serverPoseJob.parse(
    await (await scopedFetch(token, path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, synthetic_confirmed: true }),
    })).json(),
  );
  return {
    get: async () => serverPoseJob.parse(await (await scopedFetch(token, root)).json()),
    enqueue: () => post(root, {}),
    review: (decision: "accepted" | "rejected") => post(root + "/review", { decision }),
  };
}

export const CAPTURE_ARCHIVE_PAGE_SIZE = 20;

export function syntheticCapturesApi(token: string, profileId: string) {
  const root = `/profiles/${profileId}/captures`;
  return {
    list: async (offset = 0) => listSchema.parse(
      await (await scopedFetch(token,
        `${root}?limit=${CAPTURE_ARCHIVE_PAGE_SIZE}&offset=${offset}`,
      )).json(),
    ),
    create: async (png: Blob) => storedCapture.parse(await (await scopedFetch(token, root, {
      method: "POST",
      headers: { "Content-Type": "image/png", "X-Synthetic-Only": "confirmed" },
      body: png,
    })).json()),
    download: async (id: string) => (await scopedFetch(token, `${root}/${id}`)).blob(),
    remove: async (id: string) => {
      await scopedFetch(token, `${root}/${id}`, { method: "DELETE" });
    },
    purgeExpired: async () => z.object({
      deleted: z.number().int().min(0).max(100),
      batch_limit: z.literal(100),
      limit_reached: z.boolean(),
    }).parse(
      await (await scopedFetch(token, root + "/purge-expired", { method: "POST" })).json(),
    ),
  };
}

/** Re-encode in-memory and omit ancillary PNG metadata before upload. */
export async function prepareSyntheticPng(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("No se pudo leer la imagen ficticia.");
  }
  try {
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo preparar el PNG.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const encoded = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    canvas.width = canvas.height = 0;
    if (!encoded) throw new Error("No se pudo codificar el PNG.");
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!signature.every((n, i) => bytes[i] === n)) {
      throw new Error("La conversión no generó un PNG válido.");
    }
    // Retain only IHDR, IDAT and IEND with their already-valid PNG CRCs.
    const parts: BlobPart[] = [bytes.slice(0, 8)];
    let offset = 8;
    let ended = false;
    while (offset + 12 <= bytes.length) {
      const size = ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) +
        (bytes[offset + 2] << 8) + bytes[offset + 3];
      const end = offset + size + 12;
      if (end > bytes.length) throw new Error("PNG incompleto.");
      const chunk = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
      if (!["IHDR", "IDAT", "IEND"].includes(chunk)) {
        // Dropping EXIF, text, profiles, and any nonessential chunks protects
        // synthetic fixtures from accidental embedded identifying metadata.
      } else {
        parts.push(bytes.slice(offset, end));
      }
      offset = end;
      if (chunk === "IEND") { ended = true; break; }
    }
    if (!ended || offset !== bytes.length) throw new Error("PNG incompleto.");
    const stripped = new Blob(parts, { type: "image/png" });
    if (stripped.size > 262144 || stripped.size < 80) {
      throw new Error("La imagen ficticia supera 256 KiB. Usa una imagen más simple.");
    }
    return stripped;
  } finally {
    bitmap.close();
  }
}
