import { describe, expect, it } from "vitest";
import {
  frontDepthBias,
  regionalSoftTissueWeights,
  SOFT_TISSUE_PROFILE_GLSL,
  SOFT_TISSUE_REGIONS,
} from "../src/features/viewer/softTissueProfile";
import { bodyVolumeScenario } from "../src/features/viewer/bodyVolume";

describe("same-avatar regional soft-tissue simulation", () => {
  it("preserves head, hands and feet instead of uniformly inflating every vertex", () => {
    expect(regionalSoftTissueWeights(0.92, 0)).toEqual({ side: 0, depth: 0 });
    expect(regionalSoftTissueWeights(0.03, 0.04)).toEqual({ side: 0, depth: 0 });
    expect(regionalSoftTissueWeights(0.5, 0.30)).toEqual({ side: 0, depth: 0 });
    expect(regionalSoftTissueWeights(0.66, 0.32)).toEqual({ side: 0, depth: 0 });
  });

  it("gives the abdomen, hips, upper legs, chest and calves continuous visual influence", () => {
    const abdomen = regionalSoftTissueWeights(0.5, 0.04);
    const hips = regionalSoftTissueWeights(0.4, 0.04);
    const thighs = regionalSoftTissueWeights(0.28, 0.04);
    const chest = regionalSoftTissueWeights(0.72, 0.04);
    const calves = regionalSoftTissueWeights(0.18, 0.04);
    for (const zone of [abdomen, hips, thighs, chest, calves]) {
      expect(zone.side).toBeGreaterThan(0);
      expect(zone.depth).toBeGreaterThan(0);
    }
    expect(abdomen.side).toBeGreaterThan(chest.side);
    expect(abdomen.depth).toBeGreaterThan(thighs.depth);
    expect(regionalSoftTissueWeights(0.5, -0.08))
      .toEqual(regionalSoftTissueWeights(0.5, 0.08));
  });

  it("avoids discontinuities or exaggerated factors across the supported body volume range", () => {
    for (let yi = 0; yi <= 100; yi++) {
      for (let xi = -30; xi <= 30; xi++) {
        const weight = regionalSoftTissueWeights(yi / 100, xi / 100);
        expect(weight.side).toBeGreaterThanOrEqual(0);
        expect(weight.side).toBeLessThanOrEqual(1);
        expect(weight.depth).toBeGreaterThanOrEqual(0);
        expect(weight.depth).toBeLessThanOrEqual(1.12);
        for (const variation of [-30, 0, 30]) {
          const radius = bodyVolumeScenario(70, variation).radialVariation;
          const xScale = 1 + radius * weight.side;
          const zScale = 1 + radius * weight.depth * frontDepthBias(0.1);
          expect(xScale).toBeGreaterThan(0.7);
          expect(xScale).toBeLessThan(1.3);
          expect(zScale).toBeGreaterThan(0.7);
          expect(zScale).toBeLessThan(1.3);
          if (variation === 0) {
            expect(xScale).toBe(1);
            expect(zScale).toBe(1);
          }
        }
      }
    }
    const before = regionalSoftTissueWeights(0.499, 0.09);
    const after = regionalSoftTissueWeights(0.501, 0.09);
    expect(Math.abs(before.side - after.side)).toBeLessThan(0.02);
    expect(Math.abs(before.depth - after.depth)).toBeLessThan(0.02);
  });

  it("uses the same regional boundaries in JavaScript and the GPU shader", () => {
    expect(SOFT_TISSUE_REGIONS).toHaveLength(5);
    for (const region of SOFT_TISSUE_REGIONS) {
      expect(SOFT_TISSUE_PROFILE_GLSL).toContain("bvRegion_" + region.id);
      expect(SOFT_TISSUE_PROFILE_GLSL).toContain(region.rise[0].toFixed(4));
      expect(SOFT_TISSUE_PROFILE_GLSL).toContain(region.lateral[1].toFixed(4));
    }
    expect(frontDepthBias(0.1)).toBeGreaterThan(frontDepthBias(-0.1));
    expect(frontDepthBias(NaN)).toBe(1);
    expect(regionalSoftTissueWeights(NaN, 0)).toEqual({ side: 0, depth: 0 });
    expect(regionalSoftTissueWeights(0.5, Infinity)).toEqual({ side: 0, depth: 0 });
  });
});
