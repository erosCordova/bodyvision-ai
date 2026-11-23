import { describe, expect, it, vi } from "vitest";
import {
  collectSyntheticScenarioHistoryCsv, type ScenarioHistoryPage,
} from "../src/features/viewer/scenarioHistoryExport";
import type { SimulationScenario } from "../src/services/api/records";

const PROFILE = "22222222-2222-4222-8222-222222222222";
const MODEL = "28912432581accd7a1c62129d55f0e9758221d48";
const forbiddenNote = '=HYPERLINK("http://malicious.invalid","click")';

function scenario(i: number): SimulationScenario {
  return {
    id: `11111111-1111-4111-8111-${i.toString().padStart(12, "0")}`,
    profile_id: PROFILE,
    series_id: "33333333-3333-4333-8333-333333333333",
    prior_version_id: null,
    version: i + 1,
    reference_kg: 70,
    variation_percent: i % 31,
    simulated_kg: 80.5,
    stature_cm: 175,
    model_revision: MODEL,
    algorithm_revision: "regional-soft-tissue-v2",
    revision_note: forbiddenNote,
    created_by: "44444444-4444-4444-8444-444444444444",
    created_at: "2026-11-20T13:00:00Z",
    data_type: "SIMULADO",
  };
}

const rows = Array.from({ length: 45 }, (_, i) => scenario(i));
function page(offset: number, source = rows): ScenarioHistoryPage {
  return { items: source.slice(offset, offset + 20), total: source.length, limit: 20, offset };
}

describe("full synthetic scenario history CSV", () => {
  it("reads every page once, exports all 45 rows and excludes free text and identifying IDs", async () => {
    const load = vi.fn(async (offset: number) => page(offset));
    const progress = vi.fn();
    const csv = await collectSyntheticScenarioHistoryCsv(load, {
      expectedProfileId: PROFILE,
      onProgress: progress,
    });
    expect(load.mock.calls.map(([offset]) => offset)).toEqual([0, 20, 40]);
    expect(progress.mock.calls).toEqual([[20, 45], [40, 45], [45, 45]]);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(46);
    expect(csv).toContain("SIMULADO;45;70;");
    expect(csv).not.toContain(PROFILE);
    expect(csv).not.toContain(forbiddenNote);
    expect(csv).not.toContain(rows[0].created_by);
    expect(csv).not.toContain(rows[0].id);
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });

  it("keeps the initial UTC high-watermark while another synthetic row is inserted", async () => {
    const anchorTime = "2026-11-20T13:00:05.000000+00:00";
    const baseline = rows.slice(0, 45);
    const requests: Array<[number, string | undefined]> = [];
    const load = vi.fn(async (offset: number, snapshotAt?: string) => {
      requests.push([offset, snapshotAt]);
      // Simulate a newly created server row after the first page was read.
      const response = page(offset, baseline);
      return { ...response, snapshot_at: anchorTime };
    });
    const csv = await collectSyntheticScenarioHistoryCsv(load, { expectedProfileId: PROFILE });
    expect(requests).toEqual([
      [0, undefined], [20, anchorTime], [40, anchorTime],
    ]);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(46);
  });

  it("rejects altered, missing or ambiguous high-watermarks on later pages", async () => {
    const anchorTime = "2026-11-20T13:00:05Z";
    for (const later of [undefined, "2026-11-20T13:00:06Z", "2026-11-20T13:00:05"]) {
      const load = vi.fn(async (offset: number) => ({
        ...page(offset), snapshot_at: offset === 0 ? anchorTime : later,
      }));
      await expect(collectSyntheticScenarioHistoryCsv(load, {
        expectedProfileId: PROFILE,
      })).rejects.toThrow(/punto de corte/);
      expect(load).toHaveBeenCalledTimes(2);
    }
  });

  it("rejects a count change without returning a partial CSV", async () => {
    const load = vi.fn(async (offset: number) => ({
      ...page(offset), total: offset === 0 ? 45 : 46,
    }));
    await expect(collectSyntheticScenarioHistoryCsv(load, { expectedProfileId: PROFILE }))
      .rejects.toThrow(/cambió/);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("rejects duplicate pages, missing rows, invalid offsets and mixed profiles", async () => {
    const duplicate = vi.fn(async (offset: number) => offset === 20
      ? { ...page(offset), items: [rows[0], ...rows.slice(21, 40)] }
      : page(offset));
    await expect(collectSyntheticScenarioHistoryCsv(duplicate, { expectedProfileId: PROFILE }))
      .rejects.toThrow(/duplicadas/);

    const gap = vi.fn(async (offset: number) => ({
      ...page(offset), items: offset === 20 ? rows.slice(20, 30) : page(offset).items,
    }));
    await expect(collectSyntheticScenarioHistoryCsv(gap, { expectedProfileId: PROFILE }))
      .rejects.toThrow(/incompleta/);

    await expect(collectSyntheticScenarioHistoryCsv(
      async offset => ({ ...page(offset), offset: offset + 1 }),
      { expectedProfileId: PROFILE },
    )).rejects.toThrow(/inconsistente/);

    await expect(collectSyntheticScenarioHistoryCsv(
      async offset => ({ ...page(offset), items: [
        { ...rows[0], profile_id: "99999999-9999-4999-8999-999999999999" },
        ...rows.slice(1, 20),
      ] }),
      { expectedProfileId: PROFILE },
    )).rejects.toThrow(/ajeno/);
  });

  it("rejects ambiguous UTC provenance in the last page with no partial CSV", async () => {
    const altered = rows.map((item, i) => i === 44
      ? { ...item, created_at: "2026-11-20T13:00:00" }
      : item);
    const load = vi.fn(async (offset: number) => page(offset, altered));
    const progress = vi.fn();
    await expect(collectSyntheticScenarioHistoryCsv(load, {
      expectedProfileId: PROFILE, onProgress: progress,
    })).rejects.toThrow(/zona horaria/);
    expect(load.mock.calls.map(([offset]) => offset)).toEqual([0, 20, 40]);
    expect(progress).toHaveBeenCalledTimes(3);
  });

  it("stops when cancelled and never requests the next page", async () => {
    const controller = new AbortController();
    const load = vi.fn(async (offset: number) => page(offset));
    await expect(collectSyntheticScenarioHistoryCsv(load, {
      expectedProfileId: PROFILE,
      signal: controller.signal,
      onProgress: () => controller.abort(),
    })).rejects.toThrow(/cancelada/);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized, empty or non-synthetic histories before download", async () => {
    const large = vi.fn(async (offset: number) => ({
      ...page(offset), total: 2001,
    }));
    await expect(collectSyntheticScenarioHistoryCsv(large, { expectedProfileId: PROFILE }))
      .rejects.toThrow(/máximo/);
    expect(large).toHaveBeenCalledTimes(1);

    await expect(collectSyntheticScenarioHistoryCsv(async () => ({
      items: [], offset: 0, limit: 20, total: 0,
    }), { expectedProfileId: PROFILE })).rejects.toThrow(/no contiene/);

    await expect(collectSyntheticScenarioHistoryCsv(async offset => ({
      ...page(offset, [scenario(0)]),
      items: [{ ...scenario(0), data_type: "OBSERVADO" as "SIMULADO" }],
    }), { expectedProfileId: PROFILE })).rejects.toThrow(/no simulado/);
  });
});
