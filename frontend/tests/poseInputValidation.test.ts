import { describe, expect, it } from "vitest";
import {
  MAX_POSE_DIMENSION, MAX_POSE_FILE_BYTES, MAX_POSE_PIXELS,
  validatePoseImageDimensions, validatePoseImageFile,
} from "../src/features/capture/poseInputValidation";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const file = (bytes: Uint8Array, type: string) =>
  new File([bytes.slice().buffer as ArrayBuffer], "ficticia", { type });

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
