import { describe, expect, it } from "vitest";
import { atlasPixelRatio, preferredAtlasQuality } from "../src/features/viewer/renderBudget";

describe("anatomical atlas GPU pixel budget", () => {
  it("starts with fluid rendering for small screens, touch devices or modest memory", () => {
    expect(preferredAtlasQuality(390)).toBe("fluida");
    expect(preferredAtlasQuality(1440, true)).toBe("fluida");
    expect(preferredAtlasQuality(1440, false, 4)).toBe("fluida");
    expect(preferredAtlasQuality(1440, false, 8)).toBe("alta");
  });
  it("keeps high mode sharper but within a finite target pixel budget", () => {
    const ratio = atlasPixelRatio(1920, 1080, 3, "alta");
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(1.7);
    expect(1920 * 1080 * ratio ** 2).toBeLessThanOrEqual(2_500_001);
    const fluid = atlasPixelRatio(1920, 1080, 3, "fluida");
    expect(fluid).toBeLessThan(ratio);
    expect(1920 * 1080 * fluid ** 2).toBeLessThanOrEqual(950_001);
  });
  it("respects natural 1x screens and invalid ratios without NaNs", () => {
    expect(atlasPixelRatio(600, 800, 1, "alta")).toBe(1);
    expect(atlasPixelRatio(600, 800, NaN, "fluida")).toBe(1);
    expect(Number.isFinite(atlasPixelRatio(0, 0, Infinity, "alta"))).toBe(true);
  });
});
