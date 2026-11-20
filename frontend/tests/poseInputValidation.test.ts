import { describe, expect, it } from "vitest";
import {
  MAX_POSE_DIMENSION, MAX_POSE_FILE_BYTES, MAX_POSE_PIXELS,
  validatePoseImageDimensions, validatePoseImageFile,
} from "../src/features/capture/poseInputValidation";

const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
  0, 0, 4, 0, 0, 0, 4, 0,
]);
function pngDimensions(width: number, height: number): Uint8Array {
  const header = png.slice();
  const view = new DataView(header.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return header;
}
function jpegDimensions(width: number, height: number): Uint8Array {
  // SOI, APP1 metadata segment, baseline SOF0, EOI.
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe1, 0, 6, 1, 2, 3, 4,
    0xff, 0xc0, 0, 11, 8,
    (height >> 8) & 255, height & 255,
    (width >> 8) & 255, width & 255,
    1, 1, 0x11, 0,
    0xff, 0xd9,
  ]);
}
const jpeg = jpegDimensions(1024, 1024);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const file = (bytes: Uint8Array, type: string) => {
  const input = new File([bytes.slice().buffer as ArrayBuffer], "ficticia", { type });
  // jsdom's Blob does not implement arrayBuffer(); real browsers do.
  // Keep the browser-equivalent header read deterministic in unit tests.
  Object.defineProperty(input, "slice", {
    value: (start: number, end: number) => ({
      arrayBuffer: async () => bytes.slice(start, end).buffer as ArrayBuffer,
    }),
  });
  return input;
};

describe("pose input gates (synthetic local analysis only)", () => {
  it.each([
    { type: "image/png", signature: png },
    { type: "image/jpeg", signature: jpeg },
    { type: "image/webp", signature: webp },
  ])("accepts a matching $type header", async ({ type, signature }) => {
    await expect(validatePoseImageFile(file(signature, type))).resolves.toBeUndefined();
  });

  it("rejects a file whose declared MIME disagrees with the actual bytes", async () => {
    await expect(validatePoseImageFile(file(jpeg, "image/png"))).rejects.toThrow(/formato/);
    await expect(validatePoseImageFile(file(png, "image/webp"))).rejects.toThrow(/formato/);
  });

  it("rejects empty, unsupported and truncated inputs before model loading", async () => {
    await expect(validatePoseImageFile(file(new Uint8Array(), "image/png"))).rejects.toThrow(/validación/);
    await expect(validatePoseImageFile(file(png, "text/plain"))).rejects.toThrow(/validación/);
    await expect(validatePoseImageFile(file(png.slice(0, 3), "image/png"))).rejects.toThrow(/formato/);
  });

  it("rejects JPEG SOF dimensions exceeding local processing budgets before decoding", async () => {
    await expect(validatePoseImageFile(file(jpegDimensions(8000, 8000), "image/jpeg")))
      .rejects.toThrow(/dimensiones/);
    await expect(validatePoseImageFile(file(jpegDimensions(16001, 100), "image/jpeg")))
      .rejects.toThrow(/dimensiones/);
    await expect(validatePoseImageFile(file(jpegDimensions(0, 400), "image/jpeg")))
      .rejects.toThrow(/dimensiones/);
  });

  it("accepts a JPEG frame at the 32 MP budget and ignores valid APP metadata", async () => {
    await expect(validatePoseImageFile(file(jpegDimensions(16000, 2000), "image/jpeg")))
      .resolves.toBeUndefined();
  });

  it("rejects JPEGs with no SOF, truncated frame fields or invalid segment lengths", async () => {
    await expect(validatePoseImageFile(file(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), "image/jpeg")))
      .rejects.toThrow(/formato|JPEG/);
    await expect(validatePoseImageFile(file(jpeg.slice(0, 17), "image/jpeg")))
      .rejects.toThrow(/JPEG/);
    const malformed = jpeg.slice();
    malformed[4] = 0;
    malformed[5] = 1;
    await expect(validatePoseImageFile(file(malformed, "image/jpeg")))
      .rejects.toThrow(/JPEG/);
  });

  it("rejects JPEG metadata extending beyond the bounded header scan", async () => {
    const metadata = new Uint8Array(65533);
    const oversized = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff,
      ...metadata, 0xff, 0xe2, 0xff, 0xff, ...metadata, ...jpeg.slice(2)]);
    await expect(validatePoseImageFile(file(oversized, "image/jpeg")))
      .rejects.toThrow(/JPEG/);
  });

  it("rejects oversized PNG IHDR before any browser image decoding", async () => {
    await expect(validatePoseImageFile(file(pngDimensions(8000, 8000), "image/png")))
      .rejects.toThrow(/dimensiones/);
    await expect(validatePoseImageFile(file(pngDimensions(16001, 100), "image/png")))
      .rejects.toThrow(/dimensiones/);
    await expect(validatePoseImageFile(file(pngDimensions(0, 1500), "image/png")))
      .rejects.toThrow(/dimensiones/);
  });

  it("accepts a PNG IHDR exactly at the pixel and dimension budget", async () => {
    await expect(validatePoseImageFile(file(pngDimensions(16000, 2000), "image/png")))
      .resolves.toBeUndefined();
  });

  it("rejects truncated or malformed PNG IHDR before decoding", async () => {
    await expect(validatePoseImageFile(file(png.slice(0, 20), "image/png")))
      .rejects.toThrow(/cabecera/);
    const corrupt = png.slice();
    corrupt[15] = 0;
    await expect(validatePoseImageFile(file(corrupt, "image/png")))
      .rejects.toThrow(/cabecera/);
  });

  it("rejects files beyond the 10 MiB analysis budget", async () => {
    const tooLarge = file(new Uint8Array(MAX_POSE_FILE_BYTES + 1), "image/png");
    await expect(validatePoseImageFile(tooLarge)).rejects.toThrow(/validación/);
  });

  it("accepts valid dimensions within decoding and local analysis budgets", () => {
    expect(() => validatePoseImageDimensions(1024, 1024)).not.toThrow();
    expect(() => validatePoseImageDimensions(4000, 8000)).not.toThrow();
    expect(() => validatePoseImageDimensions(MAX_POSE_DIMENSION, 2000)).not.toThrow();
  });

  it("rejects decoded pixel bombs despite otherwise valid file sizes", () => {
    expect(() => validatePoseImageDimensions(8000, 8000)).toThrow(/dimensiones/);
    expect(() => validatePoseImageDimensions(MAX_POSE_DIMENSION + 1, 100)).toThrow(/dimensiones/);
    expect(MAX_POSE_PIXELS).toBe(32_000_000);
  });

  it.each([[0, 1], [-1, 40], [NaN, 10], [Infinity, 10], [100, 1.5]])(
    "rejects invalid dimensions %s x %s", (width, height) => {
      expect(() => validatePoseImageDimensions(width, height)).toThrow(/dimensiones/);
    },
  );
});
