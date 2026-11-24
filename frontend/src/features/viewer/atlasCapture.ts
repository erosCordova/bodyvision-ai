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
import { planPortraitAtlasHandoff } from "./atlasCaptureResolution";

export const ATLAS_CAPTURE_MATTE = "#344e68";

/** Only synthetic scenario numbers are permitted in an exported comparison. */
export type AtlasComparisonDetails = {
  referenceKg: number;
  referenceCm: number;
  scenarioKg: number;
  scenarioCm: number;
};

function comparisonLabel(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 300) {
    throw new Error("La comparación contiene un valor de simulación inválido.");
  }
  return Number(value.toFixed(1)).toLocaleString("es-PE", { maximumFractionDigits: 1 });
}


export async function captureOpaqueAtlasPng(
  source: HTMLCanvasElement,
  portraitForPose = false,
  comparison?: AtlasComparisonDetails,
): Promise<Blob> {
  if (!Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) ||
      source.width < 1 || source.height < 1 ||
      source.width > 16000 || source.height > 16000 ||
      source.width * source.height > 32_000_000) {
    throw new Error("Dimensiones del atlas sintético no compatibles para capturar.");
  }
  if (comparison && portraitForPose) {
    throw new Error("La comparación no puede enviarse a la revisión de pose.");
  }
  // Validate all labels before allocating a canvas; no arbitrary patient text
  // or user-provided image metadata appears in this synthetic export.
  const comparisonLabels = comparison ? [
    `IZQUIERDA · REFERENCIA: ${comparisonLabel(comparison.referenceKg)} kg / ${comparisonLabel(comparison.referenceCm)} cm`,
    `DERECHA · ESCENARIO: ${comparisonLabel(comparison.scenarioKg)} kg / ${comparisonLabel(comparison.scenarioCm)} cm`,
  ] : null;
  const portrait = portraitForPose
    ? planPortraitAtlasHandoff(source.width, source.height)
    : { width: source.width, height: source.height, offsetY: 0 };
  const footerPixels = comparison ? 96 : 0;
  const layout = { ...portrait, height: portrait.height + footerPixels };
  if (layout.width * layout.height > 3_000_000) {
    throw new Error("La comparación 3D supera el límite seguro de imagen.");
  }
  const snapshot = document.createElement("canvas");
  snapshot.width = layout.width;
  snapshot.height = layout.height;
  const ctx = snapshot.getContext("2d", { alpha: false });
  try {
    if (!ctx) throw new Error("No se pudo preparar el lienzo local de captura.");
    ctx.fillStyle = ATLAS_CAPTURE_MATTE;
    ctx.fillRect(0, 0, snapshot.width, snapshot.height);
    ctx.drawImage(source, 0, layout.offsetY);
    if (comparisonLabels) {
      const y = source.height;
      ctx.fillStyle = "#0b2538";
      ctx.fillRect(0, y, snapshot.width, 96);
      ctx.fillStyle = "#eaf6ff";
      ctx.font = "600 14px system-ui, sans-serif";
      ctx.fillText(comparisonLabels[0], 15, y + 25, Math.max(1, snapshot.width - 30));
      ctx.fillText(comparisonLabels[1], 15, y + 49, Math.max(1, snapshot.width - 30));
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = "#a6cce3";
      ctx.fillText("SIMULACIÓN VISUAL · SIN VALOR CLÍNICO", 15, y + 75,
        Math.max(1, snapshot.width - 30));
    }
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
