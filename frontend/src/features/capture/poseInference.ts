/**
 * Local pose estimation for SYNTHETIC test photos. Model and WASM are downloaded
 * to same-origin, SHA-256-verified build assets; images never leave the tab.
 * Third-party provenance and clinical privacy approval remain separate.
 */
import { validatePoseImageFile } from "./poseInputValidation";
import { preparePoseFrame } from "./poseFrame";
import {
  optionalJsHeapBytes, summarizePoseStages, type PoseLocalDiagnostic,
} from "./poseDiagnostics";

export const POSE_SDK_VERSION = "0.10.32";
export const POSE_MODEL_VERSION = "pose_landmarker_lite/float16/1";
export const POSE_WASM_URL =
  "/pose/wasm";
export const POSE_MODEL_URL =
  "/pose/pose_landmarker_lite.task";

export type PosePoint = {
  x: number;
  y: number;
  z: number;
  visibility: number;
};
export type PoseEstimate = {
  found: boolean;
  landmarks: PosePoint[];
  visiblePoints: number;
  fullBodyReview: boolean;
  model: string;
};

export const POSE_EDGES: ReadonlyArray<readonly [number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [28, 30], [30, 32],
  [15, 17], [17, 19], [19, 21], [16, 18], [18, 20], [20, 22],
  [0, 2], [2, 5], [0, 1], [1, 4],
];
const FULL_BODY_POINTS = [11, 12, 23, 24, 25, 26, 27, 28];

type RawPoseResult = {
  landmarks?: Array<Array<{
    x?: number; y?: number; z?: number; visibility?: number;
  }>>;
};

function finiteCoordinate(value: number | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Parse actual MediaPipe results, never synthesize missing landmarks. */
export function summarizePoseResult(result: RawPoseResult): PoseEstimate {
  const first = Array.isArray(result?.landmarks) ? result.landmarks[0] : undefined;
  if (!Array.isArray(first) || first.length !== 33) {
    return { found: false, landmarks: [], visiblePoints: 0, fullBodyReview: false,
      model: POSE_MODEL_VERSION };
  }
  // A third-party model may return 33 finite but entirely off-screen points.
  // At least one REAL normalized x/y pair must lie inside the image;
  // otherwise never present the data as a detected body.
  const hasAnyInFramePosition = first.some(point =>
    typeof point?.x === "number" && Number.isFinite(point.x) &&
    typeof point?.y === "number" && Number.isFinite(point.y) &&
    point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1,
  );
  if (!hasAnyInFramePosition) {
    return { found: false, landmarks: [], visiblePoints: 0, fullBodyReview: false,
      model: POSE_MODEL_VERSION };
  }
  const landmarks = first.map(point => {
    const hasPosition = typeof point?.x === "number" && Number.isFinite(point.x) &&
      typeof point?.y === "number" && Number.isFinite(point.y);
    return {
      x: finiteCoordinate(point?.x),
      y: finiteCoordinate(point?.y),
      z: finiteCoordinate(point?.z),
      visibility: hasPosition
        ? Math.max(0, Math.min(1, finiteCoordinate(point?.visibility)))
        : 0,
    };
  });
  const visible = (index: number) => {
    const point = landmarks[index];
    return point.visibility >= 0.5 &&
      point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
  };
  return {
    found: true, landmarks,
    visiblePoints: landmarks.filter((_, index) => visible(index)).length,
    fullBodyReview: FULL_BODY_POINTS.every(visible),
    model: POSE_MODEL_VERSION,
  };
}

type PoseLandmarkerInstance = {
  detect: (image: HTMLCanvasElement) => RawPoseResult;
  close: () => void;
};
type PoseVisionModule = {
  FilesetResolver: {
    forVisionTasks: (wasmUrl: string) => Promise<unknown>;
  };
  PoseLandmarker: {
    createFromOptions: (runtime: unknown, options: {
      baseOptions: { modelAssetPath: string; delegate: "CPU" };
      canvas?: HTMLCanvasElement;
      runningMode: "IMAGE";
      numPoses: number;
      minPoseDetectionConfidence: number;
      minPosePresenceConfidence: number;
      outputSegmentationMasks: boolean;
    }) => Promise<PoseLandmarkerInstance>;
  };
};

type PoseStage = "imagen" | "preparación" | "recursos" | "modelo" | "detección";
export class PoseExecutionError extends Error {
  constructor(public readonly stage: PoseStage, message: string) { super(message); this.name = "PoseExecutionError"; }
}
export function poseFailureMessage(error:unknown):string {
  if(error instanceof PoseExecutionError)return error.message;
  return "No se pudo ejecutar la detección corporal local. Reintenta con una imagen JPG, PNG o WebP.";
}
let reusableLandmarker: Promise<PoseLandmarkerInstance> | null = null;
let pageUnloadHandlerRegistered = false;

/** Reuse only the model runtime across images, never the image pixels or results. */
async function loadPoseLandmarker(): Promise<PoseLandmarkerInstance> {
  if (!reusableLandmarker) {
    reusableLandmarker = (async () => {
      let vision: PoseVisionModule;
      try {
        vision = await import("../../vendor/vision_bundle.mjs") as unknown as PoseVisionModule;
      } catch {
        throw new PoseExecutionError("recursos","No se pudo cargar el módulo de IA. Actualiza la página e inténtalo nuevamente.");
      }
      // Explicit, same-origin fileset fallback uses the already verified
      // non-SIMD assets when the automatic runtime cannot initialize.
      // A regular HTML canvas also avoids browser-specific OffscreenCanvas failures.
      const base=new URL(POSE_WASM_URL+"/",window.location.origin).href;
      const model=new URL(POSE_MODEL_URL,window.location.origin).href;
      const fallback={wasmLoaderPath:base+"vision_wasm_nosimd_internal.js",wasmBinaryPath:base+"vision_wasm_nosimd_internal.wasm"};
      const create=(fileset:unknown)=>vision.PoseLandmarker.createFromOptions(fileset,{
        baseOptions:{modelAssetPath:model,delegate:"CPU"},
        canvas:document.createElement("canvas"),
        runningMode:"IMAGE",numPoses:1,minPoseDetectionConfidence:.5,minPosePresenceConfidence:.5,
        outputSegmentationMasks:false,
      });
      try {
        const fileset=await vision.FilesetResolver.forVisionTasks(base.slice(0,-1));
        return await create(fileset);
      } catch {
        try { return await create(fallback); }
        catch {
          throw new PoseExecutionError("modelo","No se pudo iniciar MediaPipe con ninguna de las dos variantes locales. Comprueba la aceleración gráfica del navegador y actualiza la página.");
        }
      }
    })().catch(error => {
      reusableLandmarker = null;
      throw error;
    });
  }
  if (typeof window !== "undefined" && !pageUnloadHandlerRegistered) {
    pageUnloadHandlerRegistered = true;
    window.addEventListener("pagehide", () => {
      const current = reusableLandmarker;
      reusableLandmarker = null;
      void current?.then(instance => instance.close()).catch(() => {});
    });
  }
  return reusableLandmarker;
}

/**
 * An opt-in short-lived prepared frame for the repeatability benchmark.
 * Only the model runtime is shared across photos; each session owns one
 * canvas and must release it. Reusing this already-downsampled canvas avoids
 * repeating full-resolution decode for every benchmark measurement.
 */
/** Cancel only at async boundaries: MediaPipe's synchronous detect cannot be interrupted mid-call. */
export type PoseRequestIsCurrent = () => boolean;

function requireCurrentPoseRequest(isCurrent: PoseRequestIsCurrent): void {
  if (!isCurrent()) {
    throw new Error("La imagen fue sustituida o el análisis local ya no está activo.");
  }
}

export type LocalPoseSession = {
  detect: () => PoseEstimate;
  release: () => void;
};

export async function createPoseInferenceSession(
  file: File,
  isCurrent: PoseRequestIsCurrent = () => true,
): Promise<LocalPoseSession> {
  // A superseded request must not decode another image or spend CPU running
  // the model. Guard each awaited stage; the current frame always gets freed.
  requireCurrentPoseRequest(isCurrent);
  try { await validatePoseImageFile(file); }
  catch(error){throw new PoseExecutionError("imagen",error instanceof Error?error.message:"Formato de imagen no admitido.");}
  requireCurrentPoseRequest(isCurrent);
  const frame = await preparePoseFrame(file).catch(()=>{throw new PoseExecutionError("preparación","No se pudo preparar la imagen en el navegador. Prueba con una copia JPG o PNG.");});
  try {
    requireCurrentPoseRequest(isCurrent);
    const landmarker = await loadPoseLandmarker();
    requireCurrentPoseRequest(isCurrent);
    let released = false;
    return {
      detect: () => {
        if (released) throw new Error("La sesión local de pose ya fue liberada.");
        requireCurrentPoseRequest(isCurrent);
        try { return summarizePoseResult(landmarker.detect(frame.canvas)); }
        catch { const previous=reusableLandmarker; reusableLandmarker=null; void previous?.then(instance=>instance.close()).catch(()=>{}); throw new PoseExecutionError("detección","El modelo se inició, pero falló al analizar la imagen. Reintenta la detección."); }
      },
      release: () => {
        if (released) return;
        released = true;
        frame.release();
      },
    };
  } catch (error) {
    frame.release();
    throw error;
  }
}

export async function detectPoseOnDevice(
  file: File,
  isCurrent: PoseRequestIsCurrent = () => true,
): Promise<PoseEstimate> {
  // Ordinary one-shot inference keeps the same input/model and cleanup.
  // When a new image arrives, do not infer on a stale decoded frame.
  const session = await createPoseInferenceSession(file, isCurrent);
  try {
    return session.detect();
  } finally {
    session.release();
  }
}

/**
 * Explicit, optional ONE-RUN timing diagnostic over a synthetic image.
 * Unlike the five-run benchmark it measures the whole local pipeline:
 * format/header validation, bitmap decoding & scaling, model readiness,
 * detection, and temporary-canvas cleanup. The image is never retained.
 */
export async function diagnosePoseOnDevice(
  file: File,
  isCurrent: PoseRequestIsCurrent = () => true,
): Promise<PoseLocalDiagnostic> {
  requireCurrentPoseRequest(isCurrent);
  const started = performance.now();
  const jsHeapBeforeBytes = optionalJsHeapBytes(performance);
  const modelCachedAtStart = reusableLandmarker !== null;
  await validatePoseImageFile(file);
  requireCurrentPoseRequest(isCurrent);
  const validated = performance.now();
  const frame = await preparePoseFrame(file);
  const prepared = performance.now();
  let modelReady: number;
  let inferred: number;
  let detected = false;
  try {
    requireCurrentPoseRequest(isCurrent);
    const landmarker = await loadPoseLandmarker();
    requireCurrentPoseRequest(isCurrent);
    modelReady = performance.now();
    detected = summarizePoseResult(landmarker.detect(frame.canvas)).found;
    inferred = performance.now();
  } finally {
    // The original ImageBitmap was already closed in preparePoseFrame.
    frame.release();
  }
  const finished = performance.now();
  return summarizePoseStages({
    started, validated, prepared, modelReady: modelReady!, inferred: inferred!, finished,
  }, {
    detected, modelCachedAtStart, jsHeapBeforeBytes,
    jsHeapAfterBytes: optionalJsHeapBytes(performance),
  });
}
