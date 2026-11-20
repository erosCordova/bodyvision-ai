import { describe, expect, it } from "vitest";
import { buildHistoricalComparisonShape } from "../src/features/viewer/historicalComparison";
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
