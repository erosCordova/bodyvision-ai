import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  verifySavedReportFile, type SavedReportReference,
} from "../src/features/analytics/savedReportVerification";

const id = "11111111-1111-4111-8111-111111111111";
const pdfName = `bodyvision-${id}.pdf`;
const csvName = `bodyvision-historial-${id}.csv`;
const pdfBytes = new TextEncoder().encode("%PDF-1.4\nfictitious PDF content\n%%EOF");
const csvBytes = new TextEncoder().encode(
  "source_measurement_id,measured_at_utc,metric_code,value,unit,method,outlier_confirmed\r\n"
  + `${id},2026-11-22T10:00:00Z,weight,72,kg,manual,false\r\n`,
);

function fixture(
  name: string,
  bytes: Uint8Array,
  reportedSize = bytes.byteLength,
): Pick<File, "name" | "size" | "arrayBuffer"> {
  return {
    name,
    size: reportedSize,
    async arrayBuffer() { return Uint8Array.from(bytes).buffer; },
  };
}

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const receipt = (format: "pdf" | "csv", bytes: Uint8Array): SavedReportReference => ({
  format,
  filename: format === "pdf" ? pdfName : csvName,
  sha256: sha(bytes),
});

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe("selected saved report readback (not just in-memory download)", () => {
  it("accepts an identical PDF or CSV selected from disk", async () => {
    await expect(verifySavedReportFile(fixture(pdfName, pdfBytes), receipt("pdf", pdfBytes)))
      .resolves.toBeUndefined();
    await expect(verifySavedReportFile(fixture(csvName, csvBytes), receipt("csv", csvBytes)))
      .resolves.toBeUndefined();
  });

  it("rejects changed bytes even when filename and length are unchanged", async () => {
    const changed = Uint8Array.from(pdfBytes);
    changed[15] ^= 1;
    expect(changed.byteLength).toBe(pdfBytes.byteLength);
    await expect(verifySavedReportFile(fixture(pdfName, changed), receipt("pdf", pdfBytes)))
      .rejects.toThrow(/no coincide/);
  });

  it("rejects another file with the same bytes but a different name", async () => {
    await expect(verifySavedReportFile(
      fixture("other.pdf", pdfBytes),
      receipt("pdf", pdfBytes),
    )).rejects.toThrow(/mismo archivo/);
  });

  it("rejects empty, oversized, and partially read files before acceptance", async () => {
    const proof = receipt("csv", csvBytes);
    await expect(verifySavedReportFile(fixture(csvName, csvBytes, 0), proof))
      .rejects.toThrow(/vacío/);
    await expect(verifySavedReportFile(fixture(csvName, csvBytes, 8 * 1024 * 1024 + 1), proof))
      .rejects.toThrow(/límite/);
    await expect(verifySavedReportFile(fixture(csvName, csvBytes, csvBytes.length + 1), proof))
      .rejects.toThrow(/incompleta/);
  });

  it("rejects malformed reference metadata before reading local bytes", async () => {
    const proof = receipt("pdf", pdfBytes);
    const readBack = vi.fn(async () => Uint8Array.from(pdfBytes).buffer);
    const saved = { name: pdfName, size: pdfBytes.byteLength, arrayBuffer: readBack };
    await expect(verifySavedReportFile(saved, { ...proof, sha256: "0" }))
      .rejects.toThrow(/verificación/);
    await expect(verifySavedReportFile(saved, { ...proof, filename: "../file.pdf" }))
      .rejects.toThrow(/verificación/);
    expect(readBack).not.toHaveBeenCalled();
  });
});
