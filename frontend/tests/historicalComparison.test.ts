import { describe, expect, it } from "vitest";
import { buildHistoricalComparisonShape, remapHeightBounds } from "../src/features/viewer/historicalComparison";
import { bodyVisualScenario } from "../src/features/viewer/bodyVolume";

describe("historical baseline rendered on same anatomical mesh", () => {
  it("matches the actual saved shape, not the zero-percent weight", () => {
    const chosen = buildHistoricalComparisonShape({
      referenceKg: 90, variationPercent: 20, statureCm: 195,
    });
    expect(chosen.simulatedKg).toBe(108);
    expect(chosen.statureScale).toBeCloseTo(195 / 175);
    expect(chosen.radialVariation).toBeCloseTo(
      bodyVisualScenario(90, 20).scenarioRadialVariation,
    );
    expect(chosen.radialVariation).toBeGreaterThan(
      bodyVisualScenario(90, 0).referenceRadialVariation,
    );
  });
  it("keeps default reference unchanged and clamps invalid or extreme values", () => {
    const original = buildHistoricalComparisonShape({
      referenceKg: 70, variationPercent: 0, statureCm: 175,
    });
    expect(original).toEqual({
      radialVariation: 0, statureScale: 1, simulatedKg: 70, statureCm: 175,
    });
    const bad = buildHistoricalComparisonShape({
      referenceKg: Number.NaN, variationPercent: Number.POSITIVE_INFINITY,
      statureCm: -150,
    });
    expect(bad.radialVariation).toBe(0);
    expect(bad.simulatedKg).toBe(70);
    expect(bad.statureCm).toBe(145);
    expect(Number.isFinite(bad.statureScale)).toBe(true);
  });
});

describe("historical and current 3D shader bounds stay independent", () => {
  it("maps both ends of a centered atlas when the left version has a different height", () => {
    const current = { minY: -1.35, maxY: 1.35 };
    const left = remapHeightBounds(current.minY, current.maxY, 205 / 175, 155 / 175);
    expect(left.minY).toBeCloseTo(current.minY * 155 / 205);
    expect(left.maxY).toBeCloseTo(current.maxY * 155 / 205);
    expect((left.maxY - left.minY) / (155 / 175))
      .toBeCloseTo((current.maxY - current.minY) / (205 / 175));
    expect(current).toEqual({ minY: -1.35, maxY: 1.35 });
  });
  it("preserves defaults and rejects invalid GPU height scales", () => {
    expect(remapHeightBounds(-1.25, 1.25, 0.8, 0.8))
      .toEqual({ minY: -1.25, maxY: 1.25 });
    expect(() => remapHeightBounds(-1, 1, 0, 1)).toThrow(/Invalid/);
    expect(() => remapHeightBounds(Number.NaN, 1, 1, 1)).toThrow(/Invalid/);
    expect(() => remapHeightBounds(1, -1, 1, 1)).toThrow(/Invalid/);
  });
});
