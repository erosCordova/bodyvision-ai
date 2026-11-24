import { z } from "zod";

export const reportReceiptSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal("Ed25519"),
  scope: z.literal("synthetic-local-test-report"),
  format: z.enum(["pdf", "csv"]),
  export_id: z.string().uuid(),
  filename: z.string(),
  generated_at: z.string().datetime({ offset: true }),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  byte_count: z.number().int().positive().max(16 * 1024 * 1024),
  row_count: z.number().int().positive().nullable(),
  key_id: z.string().regex(/^[0-9a-f]{64}$/),
  signature: z.string().regex(/^[0-9a-f]{128}$/),
}).strict();

export type ReportReceipt = z.infer<typeof reportReceiptSchema>;

/** Binding check only. Independent signature verification needs a public key
 * obtained separately from this response, never an untrusted embedded key.
 */
export function checkReceiptBinding(receipt: ReportReceipt | null | undefined, expected: {
  format: "pdf" | "csv";
  exportId: string;
  filename: string;
  sha256: string;
  generatedAt: string;
  byteCount: number;
  rowCount: number | null;
}): void {
  if (!receipt) return;
  const parsed = reportReceiptSchema.parse(receipt);
  if (parsed.format !== expected.format || parsed.export_id !== expected.exportId
    || parsed.filename !== expected.filename || parsed.sha256 !== expected.sha256
    || Date.parse(parsed.generated_at) !== Date.parse(expected.generatedAt)
    || parsed.byte_count !== expected.byteCount || parsed.row_count !== expected.rowCount) {
    throw new Error("El comprobante de firma no corresponde al archivo recibido.");
  }
}

export function saveReportReceipt(receipt: ReportReceipt): void {
  const parsed = reportReceiptSchema.parse(receipt);
  const expectedName = parsed.format === "pdf"
    ? "bodyvision-" + parsed.export_id + ".pdf"
    : "bodyvision-historial-" + parsed.export_id + ".csv";
  if (parsed.filename !== expectedName) throw new Error("Comprobante de informe inválido.");
  const blob = new Blob([JSON.stringify(parsed, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = expectedName + ".receipt.json";
    link.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
