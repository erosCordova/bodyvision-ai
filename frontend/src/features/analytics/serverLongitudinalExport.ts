import { z } from "zod";
import { checkReceiptBinding, reportReceiptSchema } from "./reportReceipt";

export const MAX_LONGITUDINAL_BYTES = 8 * 1024 * 1024;

export const longitudinalDownloadSchema = z.object({
  export_id: z.string().uuid(),
  generated_at: z.string().datetime({ offset: true }),
  filename: z.string().regex(/^bodyvision-historial-[a-f0-9-]{36}\.csv$/),
  metric_code: z.string().min(1).max(40),
  period: z.enum(["30d", "90d", "1a", "all"]),
  row_count: z.number().int().min(1).max(MAX_LONGITUDINAL_BYTES),
  csv_base64: z.string().min(1).max(4 * Math.ceil(MAX_LONGITUDINAL_BYTES / 3)),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  receipt: reportReceiptSchema.nullable().optional(),
}).refine((report) => report.filename === `bodyvision-historial-${report.export_id}.csv`, {
  message: "El nombre del archivo no corresponde a la exportación.",
  path: ["filename"],
});
export type LongitudinalDownload = z.infer<typeof longitudinalDownloadSchema>;

const header = "source_measurement_id,measured_at_utc,metric_code,value,unit,method,outlier_confirmed";

/** Digest verifies full delivered bytes, not independent authorship. */
export async function verifiedLongitudinalCsv(value: LongitudinalDownload): Promise<Blob> {
  const report = longitudinalDownloadSchema.parse(value);
  const bytes = Uint8Array.from(atob(report.csv_base64), char => char.charCodeAt(0));
  if (bytes.byteLength > MAX_LONGITUDINAL_BYTES)
    throw new Error("El historial excede el tamaño máximo de archivo.");
  const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!body.startsWith(header + "\r\n") || body.includes("\u0000"))
    throw new Error("El servidor no devolvió un historial CSV válido.");
  // CSV values are source UUIDs, enum strings and catalog units. Units are
  // never allowed to contain line breaks in this audited demo.
  if (body.trimEnd().split("\r\n").length - 1 !== report.row_count)
    throw new Error("El CSV no coincide con el número de observaciones indicado.");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join("");
  if (sha !== report.sha256)
    throw new Error("No se pudo verificar la integridad del historial.");
  checkReceiptBinding(report.receipt, {
    format: "csv", exportId: report.export_id, filename: report.filename,
    sha256: report.sha256, generatedAt: report.generated_at, byteCount: bytes.byteLength,
    rowCount: report.row_count,
  });
  return new Blob([bytes], { type: "text/csv;charset=utf-8" });
}

export function saveLongitudinalCsv(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
