import { describe, expect, it } from "vitest";
import {
  BASELINE_HEIGHT_CM, MAX_HEIGHT_CM, MIN_HEIGHT_CM,
  clampStature, heightScale,
} from "../src/features/viewer/bodyStature";

describe("illustrative atlas stature control", () => {
  it("keeps the existing 3D anatomy at its reference height", () => {
    expect(heightScale(BASELINE_HEIGHT_CM)).toBe(1);
  });

  it("changes the same anatomy monotonically with height", () => {
    const shorter = heightScale(155);
    const taller = heightScale(195);
    expect(shorter).toBeCloseTo(155 / 175);
    expect(taller).toBeCloseTo(195 / 175);
    expect(shorter).toBeLessThan(1);
    expect(taller).toBeGreaterThan(1);
  });

  it("bounds implausible slider inputs and rejects non-finite values", () => {
    expect(clampStature(-999)).toBe(MIN_HEIGHT_CM);
    expect(clampStature(999)).toBe(MAX_HEIGHT_CM);
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(heightScale(value)).toBe(1);
    }
    expect(heightScale(1000)).toBeCloseTo(MAX_HEIGHT_CM / BASELINE_HEIGHT_CM);
  });
});
