import { webcrypto, createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { comparisonDownloadSchema, verifiedComparisonPdf } from "../src/features/analytics/serverComparisonDownload";

const pdf = "%PDF-1.4\nfictional bytes\n%%EOF\n";
const report = {
  report_id: "11111111-1111-4111-8111-111111111111",
  generated_at: "2026-11-20T18:00:00Z",
  filename: "bodyvision-11111111-1111-4111-8111-111111111111.pdf",
  pdf_base64: btoa(pdf),
  sha256: createHash("sha256").update(pdf).digest("hex"),
};
afterEach(() => vi.unstubAllGlobals());

describe("private comparison PDF delivery", () => {
  it("verifies PDF bytes with SHA-256 before making a downloadable blob", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const blob = await verifiedComparisonPdf(report);
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBe(pdf.length);
  });
  it("binds an optional receipt to the exact verified PDF before download", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const receipt = {
      version: 1 as const, algorithm: "Ed25519" as const,
      scope: "synthetic-local-test-report" as const, format: "pdf" as const,
      export_id: report.report_id, filename: report.filename,
      generated_at: report.generated_at, sha256: report.sha256,
      byte_count: pdf.length, row_count: null,
      key_id: "a".repeat(64), signature: "b".repeat(128),
    };
    await expect(verifiedComparisonPdf({ ...report, receipt })).resolves.toBeInstanceOf(Blob);
    await expect(verifiedComparisonPdf({
      ...report, receipt: { ...receipt, byte_count: pdf.length + 1 },
    })).rejects.toThrow(/comprobante/);
    await expect(verifiedComparisonPdf({
      ...report, receipt: { ...receipt, sha256: "0".repeat(64) },
    })).rejects.toThrow(/comprobante/);
  });
  it("rejects altered bytes, non-PDF content and unsafe filenames", async () => {
    vi.stubGlobal("crypto", webcrypto);
    await expect(verifiedComparisonPdf({ ...report, sha256: "0".repeat(64) }))
      .rejects.toThrow("integridad");
    await expect(verifiedComparisonPdf({ ...report, pdf_base64: btoa("<html>error</html>") }))
      .rejects.toThrow("PDF válido");
    expect(comparisonDownloadSchema.safeParse({ ...report, filename: "../../bad.html" }).success)
      .toBe(false);
    expect(comparisonDownloadSchema.safeParse({
      ...report, filename: "bodyvision-22222222-2222-4222-8222-222222222222.pdf",
    }).success).toBe(false);
  });
});
