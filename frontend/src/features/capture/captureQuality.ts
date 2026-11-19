/**
 * On-device, non-clinical capture preflight. No image bytes leave the browser.
 * These heuristics evaluate file integrity, lighting and resolution only.
 * They do not identify people, verify consent or estimate human pose.
 */
export type QualityCheck = {
  id: "resolution" | "illumination" | "contrast" | "orientation";
  label: string;
  passed: boolean;
  detail: string;
};

export type CaptureReview = {
  width: number;
  height: number;
  averageBrightness: number;
  contrast: number;
  checks: QualityCheck[];
  passed: boolean;
};

export function assessCapturePixels(
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
): CaptureReview {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width <= 0 || height <= 0 || pixels.length !== width * height * 4) {
    throw new Error("La imagen no contiene píxeles válidos.");
  }
  const total = width * height;
  let sum = 0;
  let squared = 0;
  let clipped = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const luminance =
      0.2126 * pixels[index] +
      0.7152 * pixels[index + 1] +
      0.0722 * pixels[index + 2];
    sum += luminance;
    squared += luminance * luminance;
    if (luminance < 18 || luminance > 242) clipped += 1;
  }
  const averageBrightness = sum / total;
  const contrast = Math.sqrt(Math.max(0, squared / total - averageBrightness ** 2));
  const lightingGood =
    averageBrightness >= 55 && averageBrightness <= 205 && clipped / total < 0.4;
  const checks: QualityCheck[] = [
    {
      id: "resolution", label: "Resolución",
      passed: Math.min(width, height) >= 720,
      detail: Math.min(width, height) >= 720
        ? "Ambos lados tienen al menos 720 píxeles."
        : "Se recomiendan al menos 720 píxeles en el lado más corto.",
    },
    {
      id: "illumination", label: "Iluminación",
      passed: lightingGood,
      detail: lightingGood
        ? "Brillo general adecuado para una revisión preliminar."
        : "Hay señales de iluminación extrema o zonas sobreexpuestas; revisa la foto.",
    },
    {
      id: "contrast", label: "Contraste",
      passed: contrast >= 22,
      detail: contrast >= 22
        ? "Contraste suficiente según un indicador visual básico."
        : "El contraste global es bajo. Comprueba que el cuerpo destaque del fondo.",
    },
    {
      id: "orientation", label: "Encuadre vertical",
      passed: height >= width,
      detail: height >= width
        ? "Orientación vertical adecuada para una foto de cuerpo completo."
        : "Es preferible una fotografía vertical con cabeza y pies visibles.",
    },
  ];
  return {
    width, height,
    averageBrightness: Math.round(averageBrightness),
    contrast: Math.round(contrast),
    checks,
    passed: checks.every(check => check.passed),
  };
}

export async function reviewLocalCapture(file: File): Promise<CaptureReview> {
  const supported = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!supported.has(file.type)) {
    throw new Error("Selecciona una imagen JPG, PNG o WebP.");
  }
  if (file.size === 0 || file.size > 10 * 1024 * 1024) {
    throw new Error("La imagen debe ocupar más de 0 bytes y menos de 10 MB.");
  }
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const signatureValid =
    (file.type === "image/jpeg" && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) ||
    (file.type === "image/png" && header[0] === 0x89 && header[1] === 0x50 &&
      header[2] === 0x4e && header[3] === 0x47 && header[4] === 0x0d) ||
    (file.type === "image/webp" &&
      String.fromCharCode(...header.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...header.slice(8, 12)) === "WEBP");
  if (!signatureValid) {
    throw new Error("El contenido del archivo no corresponde al formato declarado.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("No se pudo decodificar la imagen seleccionada.");
  }
  try {
    if (!bitmap.width || !bitmap.height ||
      bitmap.width > 16000 || bitmap.height > 16000) {
      throw new Error("Las dimensiones de la imagen no son compatibles.");
    }
    const factor = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
    const sampleWidth = Math.max(1, Math.round(bitmap.width * factor));
    const sampleHeight = Math.max(1, Math.round(bitmap.height * factor));
    const canvas = document.createElement("canvas");
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Este navegador no permite revisar la imagen localmente.");
    ctx.drawImage(bitmap, 0, 0, sampleWidth, sampleHeight);
    const sample = ctx.getImageData(0, 0, sampleWidth, sampleHeight);
    const result = assessCapturePixels(sampleWidth, sampleHeight, sample.data);
    const checks = result.checks.map(check =>
        check.id !== "resolution" && check.id !== "orientation"
          ? check
          : {
              ...check,
              passed: check.id === "resolution"
                ? Math.min(bitmap.width, bitmap.height) >= 720
                : bitmap.height >= bitmap.width,
              detail: check.id === "resolution"
                ? (Math.min(bitmap.width, bitmap.height) >= 720
                  ? "Ambos lados tienen al menos 720 píxeles."
                  : "Se recomiendan al menos 720 píxeles en el lado más corto.")
                : (bitmap.height >= bitmap.width
                  ? "Orientación vertical adecuada para una foto de cuerpo completo."
                  : "Es preferible una fotografía vertical con cabeza y pies visibles."),
            });
    return {
      ...result,
      width: bitmap.width,
      height: bitmap.height,
      checks,
      passed: checks.every(check => check.passed),
    };
  } finally {
    bitmap.close();
  }
}
