import { describe, expect, it } from "vitest";
import { bodyVisualScenario, bodyVolumeScenario, clampFinite } from "../src/features/viewer/bodyVolume";

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
  it("changes the same atlas silhouette when the reference weight changes", () => {
    const light = bodyVisualScenario(50, 0);
    const defaultReference = bodyVisualScenario(70, 0);
    const heavy = bodyVisualScenario(100, 0);
    expect(light.scenarioRadialVariation).toBeLessThan(defaultReference.scenarioRadialVariation);
    expect(defaultReference.scenarioRadialVariation).toBe(0);
    expect(heavy.scenarioRadialVariation).toBeGreaterThan(defaultReference.scenarioRadialVariation);
    expect(light.referenceRadialVariation).toBeCloseTo(light.scenarioRadialVariation);
    expect(heavy.referenceRadialVariation).toBeCloseTo(heavy.scenarioRadialVariation);
  });
  it("preserves the original slider response at 70 kg and separates baseline and scenario", () => {
    for (const delta of [-30, 0, 30]) {
      const visual = bodyVisualScenario(70, delta);
      expect(visual.referenceRadialVariation).toBe(0);
      expect(visual.scenarioRadialVariation).toBeCloseTo(
        bodyVolumeScenario(70, delta).radialVariation,
      );
    }
    const changed = bodyVisualScenario(100, 20);
    expect(changed.scenarioRadialVariation).toBeGreaterThan(changed.referenceRadialVariation);
  });
  it("never propagates invalid weights or slider settings to the visual mesh", () => {
    for (const weight of [NaN, Infinity, -Infinity, -100, 1000]) {
      const result = bodyVisualScenario(weight, NaN);
      expect(Number.isFinite(result.referenceRadialVariation)).toBe(true);
      expect(Number.isFinite(result.scenarioRadialVariation)).toBe(true);
    }
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
