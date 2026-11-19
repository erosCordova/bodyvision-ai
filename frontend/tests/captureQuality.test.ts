import { describe, expect, it } from "vitest";
import { assessCapturePixels } from "../src/features/capture/captureQuality";

function solidPixels(width: number, height: number, r: number, g = r, b = r) {
  const result = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < result.length; i += 4) {
    result[i] = r;
    result[i + 1] = g;
    result[i + 2] = b;
    result[i + 3] = 255;
  }
  return result;
}

describe("privacy-preserving local image quality review", () => {
  it("rejects empty and malformed pixel data", () => {
    expect(() => assessCapturePixels(0, 8, new Uint8ClampedArray(0))).toThrow();
    expect(() => assessCapturePixels(1, 1, new Uint8ClampedArray(2))).toThrow();
  });

  it("warns about low resolution and low contrast", () => {
    const result = assessCapturePixels(10, 20, solidPixels(10, 20, 120));
    expect(result.passed).toBe(false);
    expect(result.checks.find(check => check.id === "resolution")?.passed).toBe(false);
    expect(result.checks.find(check => check.id === "contrast")?.passed).toBe(false);
    expect(result.checks.find(check => check.id === "orientation")?.passed).toBe(true);
    expect(result.averageBrightness).toBe(120);
  });

  it("flags extreme brightness without claiming pose detection", () => {
    const result = assessCapturePixels(20, 20, solidPixels(20, 20, 255));
    expect(result.checks.find(check => check.id === "illumination")?.passed).toBe(false);
    expect(result.averageBrightness).toBe(255);
  });

  it("recognizes contrast and separates it from lighting and image orientation", () => {
    const pixels = solidPixels(20, 10, 75);
    for (let i = 0; i < pixels.length; i += 8) {
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 190;
    }
    const result = assessCapturePixels(20, 10, pixels);
    expect(result.contrast).toBeGreaterThan(22);
    expect(result.checks.find(check => check.id === "contrast")?.passed).toBe(true);
    expect(result.checks.find(check => check.id === "orientation")?.passed).toBe(false);
  });
});
