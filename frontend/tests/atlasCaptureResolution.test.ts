import { describe, expect, it } from "vitest";
import {
  planAtlasCapture, ATLAS_CAPTURE_MAX_EDGE, ATLAS_CAPTURE_MAX_PIXELS,
  ATLAS_CAPTURE_SHORT_SIDE,
} from "../src/features/viewer/atlasCaptureResolution";

describe("full-detail re-render for synthetic anatomical snapshots", () => {
  it("raises mobile GPU render pixels above the photographic 720px gate, not by resampling", () => {
    const plan = planAtlasCapture(390, 574, 1);
    expect(plan.width).toBeGreaterThanOrEqual(ATLAS_CAPTURE_SHORT_SIDE);
    expect(plan.height).toBeGreaterThanOrEqual(ATLAS_CAPTURE_SHORT_SIDE);
    expect(plan.pixelRatio).toBeGreaterThan(2);
    expect(plan.width * plan.height).toBeLessThanOrEqual(ATLAS_CAPTURE_MAX_PIXELS);
  });

  it("keeps sufficiently detailed desktop views within a bounded snapshot budget", () => {
    const plan = planAtlasCapture(1100, 800, 1.7);
    expect(Math.min(plan.width, plan.height)).toBeGreaterThanOrEqual(800);
    expect(plan.width * plan.height).toBeLessThanOrEqual(ATLAS_CAPTURE_MAX_PIXELS);
    expect(Math.max(plan.width, plan.height)).toBeLessThanOrEqual(ATLAS_CAPTURE_MAX_EDGE);
  });

  it("can use a fractional ratio below one on very wide desktops without lying about detail", () => {
    const plan = planAtlasCapture(2800, 1000, 1);
    expect(plan.pixelRatio).toBeLessThan(1);
    expect(plan.width).toBeLessThanOrEqual(ATLAS_CAPTURE_MAX_EDGE);
    expect(plan.height).toBeGreaterThanOrEqual(800);
  });

  it("rejects impossible tall/narrow aspect ratios and invalid view dimensions", () => {
    expect(() => planAtlasCapture(200, 1500, 1)).toThrow(/nítida/);
    for (const dimension of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => planAtlasCapture(dimension, 844, 1)).toThrow(/válidas/);
    }
  });

  it("returns the current sufficient render ratio rather than lowering it needlessly", () => {
    const plan = planAtlasCapture(600, 700, 1.6);
    expect(plan.pixelRatio).toBeCloseTo(1.6);
    expect(plan.width).toBe(960);
    expect(plan.height).toBe(1120);
  });
});
