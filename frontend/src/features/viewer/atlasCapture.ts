/**
 * A reproducible opaque matte for snapshots of the licensed synthetic atlas.
 * The on-screen Three.js renderer stays transparent and the anatomical meshes,
 * materials, pose, camera and shaders are never edited.
 *
 * A dark transparent WebGL pixel has no photographic luminance: compositing
 * before the capture preflight avoids misclassifying the empty alpha channel
 * as underexposed subject pixels.
 */
// Muted dark blue-gray studio backdrop provides silhouette separation from the
// pale skin material on a small synthetic screenshot. This is a *flat matte*:
// no contrast filter, no per-pixel subject processing and no alteration to the
// interactive WebGL material, lighting, background or camera.
export const ATLAS_CAPTURE_MATTE = "#344e68";

export async function captureOpaqueAtlasPng(source: HTMLCanvasElement): Promise<Blob> {
  if (!Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) ||
      source.width < 1 || source.height < 1 ||
      source.width > 16000 || source.height > 16000 ||
      source.width * source.height > 32_000_000) {
    throw new Error("Dimensiones del atlas sintético no compatibles para capturar.");
  }
  const snapshot = document.createElement("canvas");
  snapshot.width = source.width;
  snapshot.height = source.height;
  const ctx = snapshot.getContext("2d", { alpha: false });
  try {
    if (!ctx) throw new Error("No se pudo preparar el lienzo local de captura.");
    ctx.fillStyle = ATLAS_CAPTURE_MATTE;
    ctx.fillRect(0, 0, snapshot.width, snapshot.height);
    ctx.drawImage(source, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      snapshot.toBlob(blob => {
        if (blob && blob.size > 0) resolve(blob);
        else reject(new Error("No se pudo generar la captura 3D"));
      }, "image/png");
    });
  } finally {
    // Best-effort release, not secure erasure of browser or GPU memory.
    ctx?.clearRect(0, 0, snapshot.width, snapshot.height);
    snapshot.width = 0;
    snapshot.height = 0;
  }
}
