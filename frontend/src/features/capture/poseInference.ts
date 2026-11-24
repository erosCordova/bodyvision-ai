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
      runningMode: "IMAGE";
      numPoses: number;
      minPoseDetectionConfidence: number;
      minPosePresenceConfidence: number;
      outputSegmentationMasks: boolean;
    }) => Promise<PoseLandmarkerInstance>;
  };
};

let reusableLandmarker: Promise<PoseLandmarkerInstance> | null = null;
let pageUnloadHandlerRegistered = false;

/** Reuse only the model runtime across images, never the image pixels or results. */
async function loadPoseLandmarker(): Promise<PoseLandmarkerInstance> {
  if (!reusableLandmarker) {
    reusableLandmarker = (async () => {
      const vision = await import("../../vendor/vision_bundle.mjs") as unknown as PoseVisionModule;
      const fileset = await vision.FilesetResolver.forVisionTasks(POSE_WASM_URL);
      return vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: "CPU" },
        runningMode: "IMAGE",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        outputSegmentationMasks: false,
      });
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
  await validatePoseImageFile(file);
  requireCurrentPoseRequest(isCurrent);
  const frame = await preparePoseFrame(file);
  try {
    requireCurrentPoseRequest(isCurrent);
    const landmarker = await loadPoseLandmarker();
    requireCurrentPoseRequest(isCurrent);
    let released = false;
    return {
      detect: () => {
        if (released) throw new Error("La sesión local de pose ya fue liberada.");
        requireCurrentPoseRequest(isCurrent);
        return summarizePoseResult(landmarker.detect(frame.canvas));
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
