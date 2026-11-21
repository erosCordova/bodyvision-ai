import { describe, expect, it } from "vitest";
import { sampledMorphClamping } from "../src/features/viewer/morphLimits";
import { SOFT_TISSUE_REGIONS } from "../src/features/viewer/softTissueProfile";

describe("illustrative GPU morph saturation warning", () => {
  it("is silent for the normal synthetic reference and moderate changes", () => {
    for (const variation of [-30, -15, 0, 15, 30]) {
      expect(sampledMorphClamping(70, variation).regions).toEqual([]);
    }
    expect(sampledMorphClamping(200, 0).regions).toEqual([]);
  });
  it("warns at the GPU 1.40 limit for extreme illustrative weights", () => {
    const warning = sampledMorphClamping(200, 30);
    expect(warning.regions).toContain("abdomen");
    expect(warning.regions.every(region =>
      SOFT_TISSUE_REGIONS.some(source => source.id === region))).toBe(true);
    expect(new Set(warning.regions).size).toBe(warning.regions.length);
    expect(sampledMorphClamping(200, 15).regions.length).toBeGreaterThan(0);
  });
  it("never generates arbitrary labels and handles invalid input via the existing clamp", () => {
    expect(sampledMorphClamping(Number.NaN, 0).regions).toEqual([]);
    expect(sampledMorphClamping(70, Number.NaN).regions).toEqual([]);
    expect(sampledMorphClamping(200, 30).regions)
      .toEqual(sampledMorphClamping(200, 30).regions);
  });
});
