/**
 * Local pose estimation for SYNTHETIC test photos. Model and WASM are downloaded
 * to same-origin, SHA-256-verified build assets; images never leave the tab.
 * Third-party provenance and clinical privacy approval remain separate.
 */
import { validatePoseImageFile } from "./poseInputValidation";
import { preparePoseFrame } from "./poseFrame";

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
  const first = result.landmarks?.[0];
  if (!first || first.length !== 33) {
    return { found: false, landmarks: [], visiblePoints: 0, fullBodyReview: false,
      model: POSE_MODEL_VERSION };
  }
  // MediaPipe may return a 33-element result whose coordinates are all absent
  // or non-finite. Those are not evidence that a body was detected.
  const hasAnyFinitePosition = first.some(point =>
    typeof point?.x === "number" && Number.isFinite(point.x) &&
    typeof point?.y === "number" && Number.isFinite(point.y),
  );
  if (!hasAnyFinitePosition) {
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
export type LocalPoseSession = {
  detect: () => PoseEstimate;
  release: () => void;
};

export async function createPoseInferenceSession(file: File): Promise<LocalPoseSession> {
  // Keep format/size/header gates before decode and release the large bitmap
  // before loading MediaPipe. Never cache a user-provided image globally.
  await validatePoseImageFile(file);
  const frame = await preparePoseFrame(file);
  try {
    const landmarker = await loadPoseLandmarker();
    let released = false;
    return {
      detect: () => {
        if (released) throw new Error("La sesión local de pose ya fue liberada.");
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

export async function detectPoseOnDevice(file: File): Promise<PoseEstimate> {
  // Ordinary one-shot inference preserves the same preflight, input
  // resolution, model options and immediate resource release.
  const session = await createPoseInferenceSession(file);
  try {
    return session.detect();
  } finally {
    session.release();
  }
}
