import { validatePoseImageDimensions } from "./poseInputValidation";

/**
 * A single local MediaPipe IMAGE input created from a validated synthetic file.
 * No GPU or anatomical model configuration is changed. The temporary full-size
 * bitmap is released before the returned frame can be passed to MediaPipe.
 */
export type PreparedPoseFrame = {
  canvas: HTMLCanvasElement;
  release: () => void;
};

export async function preparePoseFrame(file: File): Promise<PreparedPoseFrame> {
  let bitmap: ImageBitmap | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let context: CanvasRenderingContext2D | null = null;

  const release = () => {
    if (!canvas) return;
    // Best-effort cleanup only. Browser/GPU memory may retain other copies.
    try {
      context?.clearRect(0, 0, canvas.width, canvas.height);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
      canvas = null;
      context = null;
    }
  };

  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    // Do not trust header-only dimensions if the decoder reports differently.
    validatePoseImageDimensions(bitmap.width, bitmap.height);
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    context = canvas.getContext("2d");
    if (!context) throw new Error("No se pudo inicializar el lienzo de análisis.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { canvas, release };
  } catch (error) {
    release();
    throw error;
  } finally {
    // This executes before preparePoseFrame resolves on success, and on error.
    // The original decoded bitmap never overlaps model initialization.
    bitmap?.close();
  }
}
