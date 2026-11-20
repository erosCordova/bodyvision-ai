import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ATLAS_CAPTURE_MATTE, captureOpaqueAtlasPng,
} from "../src/features/viewer/atlasCapture";

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
