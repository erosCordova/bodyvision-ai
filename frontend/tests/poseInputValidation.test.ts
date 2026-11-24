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
// Container-only PNG fixtures: chunk CRCs/pixels are irrelevant to predecode
// validation and are never submitted to createImageBitmap in these tests.
function pngChunk(type: string, payload = new Uint8Array()): Uint8Array {
  const bytes = new Uint8Array(12 + payload.length);
  new DataView(bytes.buffer).setUint32(0, payload.length);
  bytes.set(Array.from(type, char => char.charCodeAt(0)), 4);
  bytes.set(payload, 8);
  return bytes;
}
function pngBeforeIdat(...chunks: Uint8Array[]): Uint8Array {
  const ihdr = new Uint8Array([...pngDimensions(960, 1280), 8, 2, 0, 0, 0, 0, 0, 0, 0]);
  const pieces = [ihdr, ...chunks, pngChunk("IDAT")];
  const combined = new Uint8Array(pieces.reduce((n, part) => n + part.length, 0));
  let index = 0;
  for (const piece of pieces) { combined.set(piece, index); index += piece.length; }
  return combined;
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
function webpExtended(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0]);
  for (let shift = 0; shift < 3; shift++) {
    bytes[24 + shift] = ((width - 1) >> (8 * shift)) & 255;
    bytes[27 + shift] = ((height - 1) >> (8 * shift)) & 255;
  }
  return bytes;
}
function webpLossless(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(26);
  bytes.set([0x52, 0x49, 0x46, 0x46, 18, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x4c, 5, 0, 0, 0, 0x2f]);
  const w = width - 1;
  const h = height - 1;
  bytes[21] = w & 255;
  bytes[22] = ((w >> 8) & 0x3f) | ((h & 3) << 6);
  bytes[23] = (h >> 2) & 255;
  bytes[24] = (h >> 10) & 15;
  return bytes;
}
function webpLossy(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x20, 10, 0, 0, 0, 0, 0, 0, 0x9d, 1, 0x2a]);
  bytes[26] = width & 255;
  bytes[27] = (width >> 8) & 0x3f;
  bytes[28] = height & 255;
  bytes[29] = (height >> 8) & 0x3f;
  return bytes;
}
const webp = webpExtended(1024, 1024);
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

  it.each([
    { label: "VP8 lossy", frame: webpLossy(1200, 900) },
    { label: "VP8L lossless", frame: webpLossless(1200, 900) },
    { label: "VP8X extended", frame: webpExtended(1200, 900) },
  ])("accepts a bounded $label WebP header before decoding", async ({ frame }) => {
    await expect(validatePoseImageFile(file(frame, "image/webp"))).resolves.toBeUndefined();
  });

  it("rejects animated VP8X WebP while allowing static alpha and metadata flags", async () => {
    const animated = webpExtended(1200, 900);
    animated[20] = 0x02; // VP8X Animation flag, regardless of still-frame dimensions.
    await expect(validatePoseImageFile(file(animated, "image/webp")))
      .rejects.toThrow(/WebP animados/);

    const staticWithAlpha = webpExtended(1200, 900);
    staticWithAlpha[20] = 0x10;
    await expect(validatePoseImageFile(file(staticWithAlpha, "image/webp")))
      .resolves.toBeUndefined();

    const staticWithMetadata = webpExtended(1200, 900);
    staticWithMetadata[20] = 0x28; // ICC profile + EXIF; no animation bit.
    await expect(validatePoseImageFile(file(staticWithMetadata, "image/webp")))
      .resolves.toBeUndefined();
  });

  it("rejects excessive WebP dimensions across all three codecs", async () => {
    for (const frame of [
      webpExtended(8000, 8000), webpLossless(16001, 2000), webpLossy(8000, 8000),
    ]) {
      await expect(validatePoseImageFile(file(frame, "image/webp")))
        .rejects.toThrow(/dimensiones/);
    }
    await expect(validatePoseImageFile(file(webpExtended(16000, 2000), "image/webp")))
      .resolves.toBeUndefined();
  });

  it("rejects truncated, unknown and malformed WebP chunks before decoding", async () => {
    const truncated = webp.slice(0, 22);
    const unknown = webp.slice();
    unknown[15] = 0x21;
    const invalidLength = webp.slice();
    invalidLength[16] = 0xff;
    const badVP8L = webpLossless(100, 100);
    badVP8L[20] = 0x00;
    const badVP8 = webpLossy(100, 100);
    badVP8[23] = 0x00;
    for (const frame of [truncated, unknown, invalidLength, badVP8L, badVP8]) {
      await expect(validatePoseImageFile(file(frame, "image/webp")))
        .rejects.toThrow(/WebP/);
    }
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

  it("rejects APNG animation control before decoding while allowing static PNG metadata", async () => {
    const animated = pngBeforeIdat(
      pngChunk("tEXt", Uint8Array.from([70, 53, 0])),
      pngChunk("acTL", new Uint8Array(8)),
      pngChunk("fcTL", new Uint8Array(26)),
    );
    await expect(validatePoseImageFile(file(animated, "image/png")))
      .rejects.toThrow(/PNG animados/);

    const unexpectedFrame = pngBeforeIdat(pngChunk("fcTL", new Uint8Array(26)));
    await expect(validatePoseImageFile(file(unexpectedFrame, "image/png")))
      .rejects.toThrow(/PNG animados/);

    const staticPng = pngBeforeIdat(pngChunk("tEXt", Uint8Array.from([70, 53, 0])));
    await expect(validatePoseImageFile(file(staticPng, "image/png")))
      .resolves.toBeUndefined();
  });

  it("bounds PNG header traversal and rejects incomplete or oversized chunks", async () => {
    const manyChunks = Array.from({ length: 520 }, () => pngChunk("tEXt"));
    await expect(validatePoseImageFile(file(pngBeforeIdat(...manyChunks), "image/png")))
      .rejects.toThrow(/límite/);

    const corruptLength = pngBeforeIdat(pngChunk("tEXt"));
    // The ancillary chunk begins immediately after 33 bytes of IHDR.
    new DataView(corruptLength.buffer).setUint32(33, 0xffff_ffff);
    await expect(validatePoseImageFile(file(corruptLength, "image/png")))
      .rejects.toThrow(/tamaño declarado/);

    const noImageData = pngBeforeIdat().slice(0, 33);
    await expect(validatePoseImageFile(file(noImageData, "image/png")))
      .rejects.toThrow(/incompletos/);
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
