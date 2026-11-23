import { describe, expect, it } from "vitest";
import { buildSyntheticScenarioCsv } from "../src/features/viewer/scenarioCsv";
import type { SimulationScenario } from "../src/services/api/records";

const row: SimulationScenario = {
  id: "11111111-1111-4111-8111-111111111111",
  profile_id: "22222222-2222-4222-8222-222222222222",
  series_id: "33333333-3333-4333-8333-333333333333",
  prior_version_id: null, version: 2,
  reference_kg: 70, variation_percent: 15,
  simulated_kg: 80.5, stature_cm: 175,
  model_revision: "28912432581accd7a1c62129d55f0e9758221d48",
  algorithm_revision: "regional-soft-tissue-v2",
  revision_note: '=HYPERLINK("http://malicious.invalid","click")',
  created_by: "44444444-4444-4444-8444-444444444444",
  created_at: "2026-11-20T13:00:00Z",
  data_type: "SIMULADO",
};

describe("privacy-limited synthetic scenario CSV", () => {
  it("exports fixed provenance and numeric data, never user-provided free text or identifiers", () => {
    const result = buildSyntheticScenarioCsv([row]);
    expect(result).toContain("tipo_dato;version;peso_referencia_kg");
    expect(result).toContain("SIMULADO;2;70;15;80.5;175;2026-11-20T13:00:00.000Z");
    expect(result).toContain("regional-soft-tissue-v2");
    for (const forbidden of ["HYPERLINK", "malicious", row.profile_id,
      row.id, row.created_by, "OBSERVADO"]) {
      expect(result).not.toContain(forbidden);
    }
    expect(result.startsWith("\uFEFF")).toBe(true);
  });
  it("normalizes only explicit timezones to the same UTC instant across browsers", () => {
    const plus = buildSyntheticScenarioCsv([
      { ...row, created_at: "2026-11-20T13:00:00+05:30" },
    ]);
    expect(plus).toContain("2026-11-20T07:30:00.000Z");
    const minus = buildSyntheticScenarioCsv([
      { ...row, created_at: "2026-11-20T13:00:00-05:00" },
    ]);
    expect(minus).toContain("2026-11-20T18:00:00.000Z");
    const leapDay = buildSyntheticScenarioCsv([
      { ...row, created_at: "2024-02-29T23:45:59.123456Z" },
    ]);
    expect(leapDay).toContain("2024-02-29T23:45:59.123Z");
  });

  it("rejects ambiguous or nonexistent timestamps rather than changing UTC provenance", () => {
    for (const created_at of [
      "2026-11-20",
      "2026-11-20T13:00:00",
      "2026-11-20T13:00",
      "2026-02-29T13:00:00Z",
      "2026-02-30T13:00:00Z",
      "2026-04-31T00:00:00Z",
      "2026-11-20T24:00:00Z",
      "2026-11-20T13:00:60Z",
      "2026-11-20T13:00:00+14:30",
      "2026-11-20T13:00:00+15:00",
      "2026-11-20T13:00:00+00:99",
    ]) {
      expect(() => buildSyntheticScenarioCsv([{ ...row, created_at }])).toThrow(/fecha|zona/i);
    }
  });

  it("fails closed when the source contains observed or unsafe numbers or text", () => {
    expect(() => buildSyntheticScenarioCsv([{ ...row, data_type: "OBSERVADO" as "SIMULADO" }]))
      .toThrow(/observados/);
    expect(() => buildSyntheticScenarioCsv([{ ...row, reference_kg: Number.NaN }]))
      .toThrow(/numérico/);
    expect(() => buildSyntheticScenarioCsv([{ ...row, created_at: '=SUM(1+1)' }]))
      .toThrow(/fecha/);
    expect(() => buildSyntheticScenarioCsv([{ ...row, algorithm_revision: '=CMD' }]))
      .toThrow(/versión/);
    expect(() => buildSyntheticScenarioCsv([])).toThrow(/no vacía/);
  });
});
