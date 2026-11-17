import { describe, expect, it } from "vitest";
import { initialShape, shapeInfluences } from "../src/features/viewer/bodyShape";
describe("illustrative body shape", () => {
  it("keeps the base at its declared height and applies independent local controls", () => {
    expect(shapeInfluences(initialShape).heightScale).toBe(1);
    expect(shapeInfluences({ ...initialShape, height: 205 }).heightScale * 1.75).toBeCloseTo(2.05);
    const heavier = shapeInfluences({ ...initialShape, weight: 130 });
    expect(heavier.weights[0]).toBeGreaterThan(0);
    expect(heavier.weights[1]).toBe(0);
    const lighter = shapeInfluences({ ...initialShape, weight: 45 });
    expect(lighter.weights[0]).toBe(0);
    expect(lighter.weights[1]).toBeGreaterThan(0);
  });
  it("bounds unsupported and nonfinite inputs without opposite volume targets at once", () => {
    for (const weight of [-100, 45, 72, 95, 130, 999, NaN, Infinity]) {
      const result = shapeInfluences({ height: Infinity, weight, definition: 999 });
      expect(Number.isFinite(result.heightScale)).toBe(true);
      expect(result.weights.every(v => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
      expect(result.weights[0] * result.weights[1]).toBe(0);
    }
  });
});
