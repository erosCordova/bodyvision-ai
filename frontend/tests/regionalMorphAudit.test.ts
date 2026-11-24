import { describe, expect, it } from "vitest";
import { bodyVisualScenario } from "../src/features/viewer/bodyVolume";
import { frontDepthBias, regionalSoftTissueWeights, SOFT_TISSUE_REGIONS } from "../src/features/viewer/softTissueProfile";
import { regionalAuditBarWidth, regionalMorphAudit } from "../src/features/viewer/regionalMorphAudit";

describe("phase 8 visual regional simulation audit", () => {
  it("uses the exact five zones of the live anatomical shader, in stable order", () => {
    const regions = regionalMorphAudit(70, 0);
    expect(regions.map(x => x.id)).toEqual(SOFT_TISSUE_REGIONS.map(x => x.id));
    expect(regions.map(x => x.label)).toEqual([
      "Abdomen", "Caderas", "Pecho", "Muslos", "Pantorrillas",
    ]);
    expect(regions.every(x => x.lateralPercent === 0 && x.frontPercent === 0 && !x.limited)).toBe(true);
  });

  it("tracks increase, decrease, and restoration relative to the reference", () => {
    const larger = regionalMorphAudit(70, 25);
    const smaller = regionalMorphAudit(70, -25);
    expect(larger.every(x => x.lateralPercent > 0 && x.frontPercent > 0)).toBe(true);
    expect(smaller.every(x => x.lateralPercent < 0 && x.frontPercent < 0)).toBe(true);
    expect(larger[0].lateralPercent).toBeGreaterThan(larger[2].lateralPercent);
    expect(regionalMorphAudit(110, 0).every(x => x.lateralPercent === 0 && x.frontPercent === 0)).toBe(true);
    expect(regionalMorphAudit(70, 0)).toEqual(regionalMorphAudit(70, 0));
  });

  it("matches the actual skin GPU's clamp and front bias, not an arbitrary weight percentage", () => {
    const radial = bodyVisualScenario(70, 30).scenarioRadialVariation;
    const expectedSide = regionalSoftTissueWeights(
      (SOFT_TISSUE_REGIONS[0].rise[1] + SOFT_TISSUE_REGIONS[0].fall[0]) / 2, 0,
    ).side;
    const abdomen = regionalMorphAudit(70, 30)[0];
    expect(abdomen.lateralPercent).toBeCloseTo(
      Math.round(radial * expectedSide * 1000) / 10, 1,
    );
    expect(abdomen.frontPercent).toBeGreaterThan(abdomen.lateralPercent);
    expect(frontDepthBias(0.1)).toBeGreaterThan(1);
  });

  it("detects shader saturation and keeps report numbers finite for extremes", () => {
    const regions = regionalMorphAudit(200, 30);
    expect(regions.some(region => region.limited)).toBe(true);
    expect(regions.every(x => Number.isFinite(x.lateralPercent) && Number.isFinite(x.frontPercent))).toBe(true);
    expect(regionalMorphAudit(Number.NaN, Number.POSITIVE_INFINITY))
      .toEqual(regionalMorphAudit(70, 0));
  });

  it("bounds decorative bar widths without pretending to set clinical limits", () => {
    expect(regionalAuditBarWidth(0)).toBe(0);
    expect(regionalAuditBarWidth(-12.5)).toBe(50);
    expect(regionalAuditBarWidth(100)).toBe(100);
    expect(regionalAuditBarWidth(Number.NaN)).toBe(0);
  });
});
