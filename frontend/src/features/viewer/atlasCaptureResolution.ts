/**
 * High-resolution 3D capture planner. This is a new WebGL render of the
 * EXISTING anatomical mesh, not a pixel upscale of the fluid preview.
 * Only the explicit synthetic analysis handoff uses this temporary size.
 */
export const ATLAS_CAPTURE_SHORT_SIDE = 800;
export const ATLAS_CAPTURE_MAX_PIXELS = 2_400_000;
export const ATLAS_CAPTURE_MAX_EDGE = 2_500;
export const ATLAS_CAPTURE_MAX_PIXEL_RATIO = 4;

export type AtlasCapturePlan = {
  pixelRatio: number;
  width: number;
  height: number;
};

export function planAtlasCapture(
  cssWidth: number,
  cssHeight: number,
  currentPixelRatio: number,
): AtlasCapturePlan {
  if (![cssWidth, cssHeight, currentPixelRatio].every(Number.isFinite) ||
      cssWidth < 1 || cssHeight < 1 || currentPixelRatio <= 0) {
    throw new Error("El visor no tiene dimensiones válidas para una captura 3D.");
  }
  // WebGLRenderer floors drawing-buffer dimensions; a small subpixel margin
  // prevents a 390px viewport from becoming 799px due to floating point.
  const required = (ATLAS_CAPTURE_SHORT_SIDE + 0.5) / Math.min(cssWidth, cssHeight);
  const maximum = Math.min(
    ATLAS_CAPTURE_MAX_PIXEL_RATIO,
    ATLAS_CAPTURE_MAX_EDGE / Math.max(cssWidth, cssHeight),
    Math.sqrt(ATLAS_CAPTURE_MAX_PIXELS / (cssWidth * cssHeight)),
  );
  if (maximum + 1e-6 < required) {
    // Reject impossible aspect ratios instead of upscaling existing preview
    // pixels or falsely claiming a photograph of sufficient resolution.
    throw new Error("No se puede lograr una captura 3D nítida con este formato de pantalla.");
  }
  const pixelRatio = Math.min(maximum, Math.max(required, currentPixelRatio));
  const width = Math.floor(cssWidth * pixelRatio);
  const height = Math.floor(cssHeight * pixelRatio);
  if (Math.min(width, height) < 800 ||
      width > ATLAS_CAPTURE_MAX_EDGE || height > ATLAS_CAPTURE_MAX_EDGE ||
      width * height > ATLAS_CAPTURE_MAX_PIXELS) {
    throw new Error("No se pudo mantener un tamaño de captura 3D válido.");
  }
  return { pixelRatio, width, height };
}

/**
 * Preserve every rendered pixel of the existing synthetic atlas during a
 * portrait handoff. Letterboxing on an opaque matte changes only the empty
 * image margins, never the person, mesh, camera or shader.
 *
 * Strict limits avoid allocating giant images on ultrawide displays. The
 * ordinary PNG download uses the original (unletterboxed) aspect ratio.
 */
export function planPortraitAtlasHandoff(width: number, height: number) {
  if (![width, height].every(Number.isSafeInteger) || width < 1 || height < 1) {
    throw new Error("La captura 3D no tiene dimensiones válidas.");
  }
  const targetHeight = height >= width ? height : Math.ceil(width * 1.06);
  if (width > ATLAS_CAPTURE_MAX_EDGE || targetHeight > ATLAS_CAPTURE_MAX_EDGE ||
      width * targetHeight > ATLAS_CAPTURE_MAX_PIXELS) {
    throw new Error("El encuadre es demasiado horizontal para una captura vertical segura.");
  }
  return { width, height: targetHeight, offsetY: Math.floor((targetHeight - height) / 2) };
}
