import { describe, expect, it } from "vitest";
import {
  planAtlasCapture, planPortraitAtlasHandoff, ATLAS_CAPTURE_MAX_EDGE, ATLAS_CAPTURE_MAX_PIXELS,
  ATLAS_CAPTURE_SHORT_SIDE,
} from "../src/features/viewer/atlasCaptureResolution";

describe("full-detail re-render for synthetic anatomical snapshots", () => {
  it("pads a landscape rendered atlas to portrait without rescaling source pixels", () => {
    expect(planPortraitAtlasHandoff(979, 800)).toEqual({
      width: 979, height: 1038, offsetY: 119,
    });
    expect(planPortraitAtlasHandoff(800, 1067)).toEqual({
      width: 800, height: 1067, offsetY: 0,
    });
    expect(planPortraitAtlasHandoff(800, 800)).toEqual({
      width: 800, height: 800, offsetY: 0,
    });
  });
  it("rejects impossible portrait margins instead of allocating oversized canvases", () => {
    expect(() => planPortraitAtlasHandoff(2400, 800)).toThrow(/demasiado horizontal/);
    expect(() => planPortraitAtlasHandoff(0, 800)).toThrow(/dimensiones/);
    expect(() => planPortraitAtlasHandoff(Number.NaN, 800)).toThrow(/dimensiones/);
  });

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
