import { z } from "zod";

export const comparisonDownloadSchema = z.object({
  report_id: z.string().uuid(),
  generated_at: z.string().datetime({ offset: true }),
  filename: z.string().regex(/^bodyvision-[a-f0-9-]{36}\.pdf$/),
  pdf_base64: z.string().min(1).max(100000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).refine((report) => report.filename === `bodyvision-${report.report_id}.pdf`, {
  message: "El nombre del archivo no corresponde al informe.",
  path: ["filename"],
});
export type ComparisonDownload = z.infer<typeof comparisonDownloadSchema>;

/** Verify delivered bytes before making a download. No persistent browser cache. */
export async function verifiedComparisonPdf(report: ComparisonDownload): Promise<Blob> {
  const parsed = comparisonDownloadSchema.parse(report);
  const bytes = Uint8Array.from(atob(parsed.pdf_base64), char => char.charCodeAt(0));
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== "%PDF-1.4")
    throw new Error("El servidor no devolvió un PDF válido.");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (hex !== parsed.sha256) throw new Error("No se pudo verificar la integridad del PDF.");
  return new Blob([bytes], { type: "application/pdf" });
}

export function saveComparisonPdf(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    // Allow the browser to start the download before releasing its in-memory URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
