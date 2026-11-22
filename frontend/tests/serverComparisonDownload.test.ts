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
