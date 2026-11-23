import { afterEach, describe, expect, it, vi } from "vitest";
import { reviewLocalCapture } from "../src/features/capture/captureQuality";

function syntheticFile(bytes: Uint8Array, type: string): File {
  const file = new File([bytes.slice().buffer as ArrayBuffer], "imagen-ficticia", { type });
  // jsdom lacks native Blob.arrayBuffer in this test environment.
  Object.defineProperty(file, "slice", {
    value: (start: number, end: number) => ({
      arrayBuffer: async () => bytes.slice(start, end).buffer as ArrayBuffer,
    }),
  });
  return file;
}
function png(width: number, height: number): Uint8Array {
  const bytes = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const data = new DataView(bytes.buffer);
  data.setUint32(16, width); data.setUint32(20, height);
  return bytes;
}
function jpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0, 11, 8,
    (height >> 8) & 255, height & 255,
    (width >> 8) & 255, width & 255,
    1, 1, 0x11, 0,
  ]);
}
function webp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0]);
  for (let shift = 0; shift < 3; shift++) {
    bytes[24 + shift] = ((width - 1) >> (8 * shift)) & 255;
    bytes[27 + shift] = ((height - 1) >> (8 * shift)) & 255;
  }
  return bytes;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("capture/pose shared pre-decode budget (synthetic images)", () => {
  it.each([
    ["PNG", "image/png", png(8000, 8000)],
    ["JPEG", "image/jpeg", jpeg(8000, 8000)],
    ["WebP", "image/webp", webp(8000, 8000)],
  ])("rejects oversized %s in capture before opening a bitmap", async (_name, type, bytes) => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    await expect(reviewLocalCapture(syntheticFile(bytes as Uint8Array, type as string)))
      .rejects.toThrow(/dimensiones/);
    expect(decode).not.toHaveBeenCalled();
  });

  it("rejects animated WebP before preview sampling or MediaPipe can decode it", async () => {
    const animated = webp(960, 1280);
    animated[20] = 0x02;
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    await expect(reviewLocalCapture(syntheticFile(animated, "image/webp")))
      .rejects.toThrow(/WebP animados/);
    expect(decode).not.toHaveBeenCalled();
  });

  it("rejects a truncated file with matching MIME before decoding", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    await expect(reviewLocalCapture(syntheticFile(png(1000, 1000).slice(0, 18), "image/png")))
      .rejects.toThrow(/cabecera/);
    expect(decode).not.toHaveBeenCalled();
  });

  it("rejects inconsistent real decoded dimensions and always closes the bitmap", async () => {
    const close = vi.fn();
    const decode = vi.fn().mockResolvedValue({ width: 8000, height: 8000, close });
    vi.stubGlobal("createImageBitmap", decode);
    await expect(reviewLocalCapture(syntheticFile(png(900, 1100), "image/png")))
      .rejects.toThrow(/dimensiones/);
    expect(decode).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("clears pixel samples and temporary canvas after successful local review", async () => {
    const close = vi.fn();
    const decode = vi.fn().mockResolvedValue({ width: 900, height: 1200, close });
    vi.stubGlobal("createImageBitmap", decode);
    let sample: Uint8ClampedArray | undefined;
    const clearRect = vi.fn();
    const context = {
      drawImage: vi.fn(), clearRect,
      getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => {
        sample = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < sample.length; i += 4) {
          const value = i % 8 ? 80 : 200;
          sample[i] = sample[i + 1] = sample[i + 2] = value;
          sample[i + 3] = 255;
        }
        return { data: sample };
      }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const result = await reviewLocalCapture(syntheticFile(png(900, 1200), "image/png"));
    expect(result.width).toBe(900);
    expect(result.height).toBe(1200);
    expect(result.checks).toHaveLength(4);
    expect(sample?.every(value => value === 0)).toBe(true);
    expect(clearRect).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes a decoded bitmap even if canvas creation cannot obtain a 2D context", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({
      width: 900, height: 1200, close,
    }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await expect(reviewLocalCapture(syntheticFile(png(900, 1200), "image/png")))
      .rejects.toThrow(/navegador/);
    expect(close).toHaveBeenCalledOnce();
  });
});
