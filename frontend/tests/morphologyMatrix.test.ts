/**
 * Deterministic morphological regression grid for the *illustrative* GPU
 * material, NOT patient morphology, medical accuracy or real-device evidence.
 * Each point samples the existing CPU source of GLSL region masks.
 */
import { describe, expect, it } from "vitest";
import { bodyVisualScenario } from "../src/features/viewer/bodyVolume";
import { heightScale } from "../src/features/viewer/bodyStature";
import {
  frontDepthBias, regionalSoftTissueWeights, SOFT_TISSUE_REGIONS,
} from "../src/features/viewer/softTissueProfile";
import {
  buildHistoricalComparisonShape, remapHeightBounds,
} from "../src/features/viewer/historicalComparison";

const REFERENCES = [40, 70, 110, 200] as const;
const VARIATIONS = [-30, -15, 0, 15, 30] as const;
const STATURES = [145, 175, 205] as const;
const SIDES = ["front", "back"] as const;
const POINTS = [
  { id: "abdomen", y: 0.50, lateral: 0.04, protected: false },
  { id: "hips", y: 0.39, lateral: 0.04, protected: false },
  { id: "chest", y: 0.71, lateral: 0.04, protected: false },
  { id: "thighs", y: 0.28, lateral: 0.04, protected: false },
  { id: "calves", y: 0.18, lateral: 0.04, protected: false },
  { id: "head", y: 0.94, lateral: 0.04, protected: true },
  { id: "feet", y: 0.03, lateral: 0.04, protected: true },
  { id: "outer-arm", y: 0.50, lateral: 0.31, protected: true },
] as const;

function gpuClamp(value: number) {
  return Math.max(0.60, Math.min(1.40, value));
}

/** Equivalent strength=1 skin formula, not a second rendering algorithm. */
function syntheticSkinScale(referenceKg: number, delta: number, y: number,
  lateral: number, side: "front" | "back") {
  const radial = bodyVisualScenario(referenceKg, delta).scenarioRadialVariation;
  const zones = regionalSoftTissueWeights(y, lateral);
  const bias = frontDepthBias(side === "front" ? 0.10 : -0.10);
  const rawX = 1 + radial * zones.side;
  const rawZ = 1 + radial * zones.depth * bias;
  return { x: gpuClamp(rawX), z: gpuClamp(rawZ), rawX, rawZ };
}

describe("synthetic morphology acceptance matrix (no clinical claims)", () => {
  it("covers all 960 supported references, variations, statures, regions and views", () => {
    let cases = 0;
    let clippingSamples = 0;
    for (const referenceKg of REFERENCES) {
      for (const stature of STATURES) {
        const yStretch = heightScale(stature);
        expect(yStretch).toBeCloseTo(stature / 175, 10);
        for (const point of POINTS) {
          for (const side of SIDES) {
            let lastX = -Infinity;
            let lastZ = -Infinity;
            for (const delta of VARIATIONS) {
              cases++;
              const current = syntheticSkinScale(referenceKg, delta, point.y, point.lateral, side);
              const mirrored = syntheticSkinScale(referenceKg, delta, point.y, -point.lateral, side);
              // No left/right asymmetry is introduced by the regional masks.
              expect(current.x).toBeCloseTo(mirrored.x, 12);
              expect(current.z).toBeCloseTo(mirrored.z, 12);
              // Less weight must never lead to a wider GPU region than more.
              expect(current.x + 1e-10).toBeGreaterThanOrEqual(lastX);
              expect(current.z + 1e-10).toBeGreaterThanOrEqual(lastZ);
              lastX = current.x;
              lastZ = current.z;
              expect(current.x).toBeGreaterThanOrEqual(0.60);
              expect(current.x).toBeLessThanOrEqual(1.40);
              expect(current.z).toBeGreaterThanOrEqual(0.60);
              expect(current.z).toBeLessThanOrEqual(1.40);
              if (point.protected) {
                // Head, feet and distant arms are not artificially fattened.
                expect(current.x).toBe(1);
                expect(current.z).toBe(1);
              }
              if (current.x !== current.rawX || current.z !== current.rawZ) {
                clippingSamples++;
              }
            }
          }
        }
      }
    }
    expect(cases).toBe(960);
    // Document the shader's saturation at extreme synthetic weights;
    // the model must never be presented as a physical morphology predictor.
    expect(clippingSamples).toBeGreaterThan(0);
  });

  it("keeps the CPU masks and shader region list aligned across the five regions", () => {
    expect(SOFT_TISSUE_REGIONS.map(region => region.id)).toEqual([
      "abdomen", "hips", "chest", "thighs", "calves",
    ]);
    for (const sample of POINTS.filter(point => !point.protected)) {
      const regions = regionalSoftTissueWeights(sample.y, sample.lateral);
      expect(regions.side, sample.id).toBeGreaterThan(0);
      expect(regions.depth, sample.id).toBeGreaterThan(0);
    }
    const sample = syntheticSkinScale(70, 30, 0.50, 0.04, "front");
    expect(sample.x).toBeGreaterThan(1);
    expect(sample.z).toBeGreaterThan(sample.x);
    const back = syntheticSkinScale(70, 30, 0.50, 0.04, "back");
    expect(sample.z).toBeGreaterThan(back.z);
    expect(sample.x).toEqual(back.x);
  });

  it("preserves exact base shape and separates historic 145 cm from current 205 cm bounds", () => {
    for (const stature of STATURES) {
      const original = syntheticSkinScale(70, 0, 0.5, 0.04, "front");
      expect(original.x).toBe(1);
      expect(original.z).toBe(1);
      // Vertical stature does not change the generated skin cross-section.
      expect(heightScale(stature)).toBe(stature / 175);
    }
    const historic = buildHistoricalComparisonShape({
      referenceKg: 110, variationPercent: -15, statureCm: 145,
    });
    const current = buildHistoricalComparisonShape({
      referenceKg: 110, variationPercent: 30, statureCm: 205,
    });
    expect(historic.radialVariation).toBeLessThan(current.radialVariation);
    expect(historic.statureScale).toBeLessThan(current.statureScale);
    const shaderBounds = { min: -1.3, max: 1.3 };
    const left = remapHeightBounds(
      shaderBounds.min, shaderBounds.max, current.statureScale, historic.statureScale,
    );
    expect(left.maxY - left.minY).toBeCloseTo(
      (shaderBounds.max - shaderBounds.min) * 145 / 205,
    );
    expect(shaderBounds).toEqual({ min: -1.3, max: 1.3 });
  });
});
