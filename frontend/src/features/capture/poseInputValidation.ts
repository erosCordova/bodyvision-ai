/**
 * Input gates for synthetic, on-device pose inference.
 * Limits are defensive processing bounds, not clinical quality criteria.
 */
export const MAX_POSE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_POSE_DIMENSION = 16000;
export const MAX_POSE_PIXELS = 32_000_000;

export async function validatePoseImageFile(file: File): Promise<void> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size === 0 || file.size > MAX_POSE_FILE_BYTES) {
    throw new Error("La fotografía no supera la validación local.");
  }
  // PNG stores dimensions in IHDR, before compressed pixels are decoded.
  // JPEG and WebP are still bounded after decoding; do not claim a preflight for them.
  const bytes = new Uint8Array(await file.slice(0, file.type === "image/png" ? 24 : 12).arrayBuffer());
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
