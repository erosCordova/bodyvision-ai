import { webcrypto, createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  longitudinalDownloadSchema, verifiedLongitudinalCsv,
} from "../src/features/analytics/serverLongitudinalExport";

const csv = "source_measurement_id,measured_at_utc,metric_code,value,unit,method,outlier_confirmed\r\n"
  + "11111111-1111-4111-8111-111111111111,2026-11-01T10:00:00Z,weight,70,kg,manual,false\r\n"
  + "22222222-2222-4222-8222-222222222222,2026-11-20T10:00:00Z,weight,77,kg,manual,false\r\n";
const report = {
  export_id: "33333333-3333-4333-8333-333333333333",
  generated_at: "2026-11-20T10:00:00Z",
  filename: "bodyvision-historial-33333333-3333-4333-8333-333333333333.csv",
  metric_code: "weight",
  period: "all" as const,
  row_count: 2,
  csv_base64: btoa(csv),
  sha256: createHash("sha256").update(csv).digest("hex"),
};
afterEach(() => vi.unstubAllGlobals());

describe("private longitudinal CSV delivery", () => {
  it("verifies all source rows with SHA-256 before forming a downloadable blob", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const blob = await verifiedLongitudinalCsv(report);
    expect(blob.type).toContain("text/csv");
    expect(await blob.text()).toBe(csv);
  });
  it("rejects tampering, incomplete rows, unsafe filenames and invalid UTF-8", async () => {
    vi.stubGlobal("crypto", webcrypto);
    await expect(verifiedLongitudinalCsv({ ...report, sha256: "0".repeat(64) }))
      .rejects.toThrow(/integridad/);
    await expect(verifiedLongitudinalCsv({ ...report, row_count: 1 }))
      .rejects.toThrow(/número/);
    await expect(verifiedLongitudinalCsv({ ...report, csv_base64: btoa("not a CSV") }))
      .rejects.toThrow(/CSV válido/);
    await expect(verifiedLongitudinalCsv({ ...report, csv_base64: btoa(String.fromCharCode(0xff)) }))
      .rejects.toThrow();
    expect(longitudinalDownloadSchema.safeParse({ ...report, filename: "../../bad.csv" }).success)
      .toBe(false);
    expect(longitudinalDownloadSchema.safeParse({ ...report, row_count: 501 }).success)
      .toBe(false);
  });
});
