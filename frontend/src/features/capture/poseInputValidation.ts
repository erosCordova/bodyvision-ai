/**
 * Input gates for synthetic, on-device pose inference.
 * Limits are defensive processing bounds, not clinical quality criteria.
 */
export const MAX_POSE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_POSE_DIMENSION = 16000;
export const MAX_POSE_PIXELS = 32_000_000;
export const MAX_JPEG_HEADER_SCAN_BYTES = 128 * 1024;

/**
 * Read JPEG frame dimensions without decoding its compressed image.
 * JPEG APP/metadata segments can precede SOF; refuse files whose SOF is not
 * within the bounded scan rather than letting an unbounded image be decoded.
 */
export function readJpegFrameDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("La cabecera JPEG es inválida.");
  }
  const frameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) break;
    while (bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda || marker === 0x00) break;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if (frameMarkers.has(marker)) {
      if (length < 7) break;
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    offset += length;
  }
  throw new Error("No se encontraron dimensiones JPEG válidas en la cabecera.");
}

/**
 * Read still-image dimensions from the first WebP chunk without decoding.
 * Covers VP8 (lossy), VP8L (lossless) and VP8X (extended/animated).
 * RIFF chunk lengths are checked against the declared container size.
 */
export function readWebpFrameDimensions(bytes: Uint8Array): { width: number; height: number } {
  const invalid = () => new Error("La cabecera WebP no contiene dimensiones válidas.");
  if (bytes.length < 20 ||
      bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46 ||
      bytes[8] !== 0x57 || bytes[9] !== 0x45 || bytes[10] !== 0x42 || bytes[11] !== 0x50) {
    throw invalid();
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = view.getUint32(4, true);
  const chunkSize = view.getUint32(16, true);
  if (riffSize < 4 + 8 + chunkSize + (chunkSize % 2)) throw invalid();

  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8X") {
    if (chunkSize < 10 || bytes.length < 30) throw invalid();
    return {
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
    };
  }
  if (chunk === "VP8L") {
    if (chunkSize < 5 || bytes.length < 25 || bytes[20] !== 0x2f ||
        (bytes[24] & 0xe0) !== 0) throw invalid();
    return {
      width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
      height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
    };
  }
  if (chunk === "VP8 ") {
    if (chunkSize < 10 || bytes.length < 30 || (bytes[20] & 1) !== 0 ||
        bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) throw invalid();
    return {
      width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
      height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
    };
  }
  throw invalid();
}

export async function validatePoseImageFile(file: File): Promise<void> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size === 0 || file.size > MAX_POSE_FILE_BYTES) {
    throw new Error("La fotografía no supera la validación local.");
  }
  // All three supported formats expose dimensions before decompression.
  const headerBytes = file.type === "image/png" ? 24 :
    file.type === "image/jpeg" ? MAX_JPEG_HEADER_SCAN_BYTES : 30;
  const bytes = new Uint8Array(await file.slice(0, headerBytes).arrayBuffer());
  const valid =
    (file.type === "image/jpeg" &&
      bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (file.type === "image/png" &&
      bytes[0] === 0x89 && bytes[1] === 0x50 &&
      bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a &&
      bytes[6] === 0x1a && bytes[7] === 0x0a) ||
    (file.type === "image/webp" &&
      bytes[0] === 0x52 && bytes[1] === 0x49 &&
      bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 &&
      bytes[10] === 0x42 && bytes[11] === 0x50);
  if (!valid) {
    throw new Error("El contenido de la fotografía no corresponde al formato declarado.");
  }
  if (file.type === "image/jpeg") {
    const { width, height } = readJpegFrameDimensions(bytes);
    validatePoseImageDimensions(width, height);
  }
  if (file.type === "image/webp") {
    const { width, height } = readWebpFrameDimensions(bytes);
    validatePoseImageDimensions(width, height);
  }
  if (file.type === "image/png") {
    if (bytes.length < 24 ||
        bytes[8] !== 0 || bytes[9] !== 0 || bytes[10] !== 0 || bytes[11] !== 13 ||
        bytes[12] !== 0x49 || bytes[13] !== 0x48 ||
        bytes[14] !== 0x44 || bytes[15] !== 0x52) {
      throw new Error("La cabecera PNG no contiene dimensiones válidas.");
    }
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    validatePoseImageDimensions(header.getUint32(16), header.getUint32(20));
  }
}

export function validatePoseImageDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width <= 0 || height <= 0 ||
      width > MAX_POSE_DIMENSION || height > MAX_POSE_DIMENSION ||
      width * height > MAX_POSE_PIXELS) {
    throw new Error("Las dimensiones de la fotografía exceden los límites de análisis local.");
  }
}
