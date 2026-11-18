import { describe, expect, it } from "vitest";
import { bodyVolumeScenario, clampFinite } from "../src/features/viewer/bodyVolume";

describe("illustrative anatomical body-volume simulator", () => {
  it("keeps the undeformed body at its starting weight", () => {
    const base = bodyVolumeScenario(70, 0);
    expect(base.simulatedKg).toBe(70);
    expect(base.radialVariation).toBe(0);
  });
  it("changes visual radius monotonically with a bounded hypothetical weight", () => {
    const lighter = bodyVolumeScenario(70, -30);
    const base = bodyVolumeScenario(70, 0);
    const heavier = bodyVolumeScenario(70, 30);
    expect(lighter.simulatedKg).toBe(49);
    expect(heavier.simulatedKg).toBe(91);
    expect(lighter.radialVariation).toBeLessThan(base.radialVariation);
    expect(base.radialVariation).toBeLessThan(heavier.radialVariation);
    expect(lighter.radialVariation).toBeCloseTo(Math.sqrt(0.7) - 1);
    expect(heavier.radialVariation).toBeCloseTo(Math.sqrt(1.3) - 1);
  });
  it("clamps unsupported inputs and never returns an invalid shader uniform", () => {
    for (const value of [-999, -30, 0, 30, 999, NaN, Infinity, -Infinity]) {
      const scenario = bodyVolumeScenario(Infinity, value);
      expect(scenario.referenceKg).toBe(70);
      expect(scenario.variationPercent).toBeGreaterThanOrEqual(-30);
      expect(scenario.variationPercent).toBeLessThanOrEqual(30);
      expect(Number.isFinite(scenario.radialVariation)).toBe(true);
      expect(Number.isFinite(scenario.simulatedKg)).toBe(true);
    }
    expect(clampFinite(-10, 40, 200, 70)).toBe(40);
    expect(clampFinite(400, 40, 200, 70)).toBe(200);
  });
});
