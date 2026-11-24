import { afterEach, describe, expect, it, vi } from "vitest";
import { preparePoseFrame } from "../src/features/capture/poseFrame";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubDrawing() {
  const drawImage = vi.fn();
  const clearRect = vi.fn();
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue({ drawImage, clearRect } as unknown as CanvasRenderingContext2D);
  return { drawImage, clearRect, getContext };
}

function stubBitmap(width: number, height: number) {
  const close = vi.fn();
  const create = vi.fn().mockResolvedValue({ width, height, close });
  vi.stubGlobal("createImageBitmap", create);
  return { close, create };
}

describe("Fase 5: release large source bitmap before loading MediaPipe", () => {
  it("downsamples a 32MP synthetic input to the unchanged 1024px budget and closes bitmap first", async () => {
    const input = new File(["synthetic"], "large.png", { type: "image/png" });
    const { close, create } = stubBitmap(8000, 4000);
    const { drawImage, clearRect } = stubDrawing();

    const frame = await preparePoseFrame(input);
    expect(create).toHaveBeenCalledWith(input, { imageOrientation: "from-image" });
    expect(frame.canvas.width).toBe(1024);
    expect(frame.canvas.height).toBe(512);
    expect(drawImage).toHaveBeenCalledWith(
      expect.objectContaining({ width: 8000, height: 4000 }),
      0, 0, 1024, 512,
    );
    expect(close).toHaveBeenCalledOnce();
    expect(drawImage.mock.invocationCallOrder[0])
      .toBeLessThan(close.mock.invocationCallOrder[0]);
    // The original is closed before this frame reaches the model loader.
    expect(clearRect).not.toHaveBeenCalled();
    frame.release();
    expect(clearRect).toHaveBeenCalledWith(0, 0, 1024, 512);
    expect(frame.canvas.width).toBe(0);
    expect(frame.canvas.height).toBe(0);
    frame.release();
    expect(clearRect).toHaveBeenCalledOnce();
  });

  it("does not upscale a smaller synthetic photo", async () => {
    stubBitmap(640, 840);
    const { drawImage } = stubDrawing();
    const frame = await preparePoseFrame(new File(["test"], "small.png"));
    expect(frame.canvas.width).toBe(640);
    expect(frame.canvas.height).toBe(840);
    expect(drawImage).toHaveBeenCalledOnce();
    frame.release();
  });

  it("closes a decoded oversized bitmap without allocating a canvas", async () => {
    const { close } = stubBitmap(10000, 10000);
    const create = vi.spyOn(document, "createElement");
    await expect(preparePoseFrame(new File(["test"], "huge.png")))
      .rejects.toThrow(/dimensiones/);
    expect(create).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes a bitmap and clears allocated canvas when drawing fails", async () => {
    const { close } = stubBitmap(900, 1200);
    const { drawImage, clearRect } = stubDrawing();
    drawImage.mockImplementation(() => { throw new Error("synthetic draw failure"); });
    let allocated: HTMLCanvasElement | null = null;
    const nativeCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
      const element = nativeCreate(tagName, options);
      if (tagName === "canvas") allocated = element as HTMLCanvasElement;
      return element;
    });
    await expect(preparePoseFrame(new File(["test"], "broken.png")))
      .rejects.toThrow(/draw failure/);
    expect(close).toHaveBeenCalledOnce();
    expect(clearRect).toHaveBeenCalledOnce();
    expect(allocated).not.toBeNull();
    expect((allocated as HTMLCanvasElement | null)?.width).toBe(0);
  });

  it("closes the original bitmap if the browser lacks a 2D context", async () => {
    const { close } = stubBitmap(900, 1200);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await expect(preparePoseFrame(new File(["test"], "unsupported.png")))
      .rejects.toThrow(/lienzo/);
    expect(close).toHaveBeenCalledOnce();
  });
});
