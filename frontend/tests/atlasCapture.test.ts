import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ATLAS_CAPTURE_MATTE, captureOpaqueAtlasPng,
} from "../src/features/viewer/atlasCapture";
import { assessCapturePixels } from "../src/features/capture/captureQuality";

afterEach(() => { vi.restoreAllMocks(); });

describe("synthetic opaque atlas snapshot", () => {
  it("composites existing transparent WebGL canvas over neutral matte and preserves source", async () => {
    const input = document.createElement("canvas");
    input.width = 900; input.height = 1100;
    const drawImage = vi.fn();
    const fillRect = vi.fn();
    const clearRect = vi.fn();
    const context = { fillStyle: "", fillRect, drawImage, clearRect };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const encoded = new Blob(["synthetic-png"], { type: "image/png" });
    const encode = vi.spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation(callback => callback(encoded));
    const result = await captureOpaqueAtlasPng(input);
    expect(result).toBe(encoded);
    expect(context.fillStyle).toBe(ATLAS_CAPTURE_MATTE);
    expect(fillRect).toHaveBeenCalledWith(0, 0, 900, 1100);
    expect(drawImage).toHaveBeenCalledWith(input, 0, 0);
    expect(encode).toHaveBeenCalledOnce();
    expect(clearRect).toHaveBeenCalledOnce();
    expect(input.width).toBe(900);
    expect(input.height).toBe(1100);
  });

  it("creates a flat contrasting studio matte for a small synthetic silhouette without changing quality gates", () => {
    // A small, explicit 10%-occupancy fictitious skin rectangle, not a clinical
    // sample or mocked pose. The untouched preflight evaluates real RGB pixels.
    const width = 80, height = 120;
    const pixels = new Uint8ClampedArray(width * height * 4);
    const matte = ATLAS_CAPTURE_MATTE.match(/^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    expect(matte).not.toBeNull();
    const background = matte!.slice(1).map(hex => Number.parseInt(hex, 16));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const syntheticSkin = x >= 32 && x < 48 && y >= 30 && y < 90;
        const rgb = syntheticSkin ? [200, 149, 120] : background;
        pixels[i] = rgb[0];
        pixels[i + 1] = rgb[1];
        pixels[i + 2] = rgb[2];
        pixels[i + 3] = 255;
      }
    }
    const result = assessCapturePixels(width, height, pixels);
    expect(result.checks.find(check => check.id === "contrast")?.passed).toBe(true);
    expect(result.checks.find(check => check.id === "illumination")?.passed).toBe(true);
    // No "quality pass" claim for a tiny synthetic fixture below 720px.
    expect(result.passed).toBe(false);
    expect(result.checks.find(check => check.id === "resolution")?.passed).toBe(false);
  });

  it("rejects oversized source surfaces before allocating a capture canvas", async () => {
    const input = document.createElement("canvas");
    input.width = 8000; input.height = 8000;
    const createElement = vi.spyOn(document, "createElement");
    await expect(captureOpaqueAtlasPng(input)).rejects.toThrow(/Dimensiones/);
    expect(createElement).not.toHaveBeenCalled();
  });

  it("cleans allocated temporary surfaces if PNG encoding fails", async () => {
    const input = document.createElement("canvas");
    input.width = 800; input.height = 1100;
    const clearRect = vi.fn();
    const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn(), clearRect };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation(callback => callback(null));
    await expect(captureOpaqueAtlasPng(input)).rejects.toThrow(/generar/);
    expect(clearRect).toHaveBeenCalledOnce();
    expect(input.width).toBe(800);
  });
});
