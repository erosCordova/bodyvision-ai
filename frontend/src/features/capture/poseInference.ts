/**
 * Local pose estimation for SYNTHETIC test photos. Model and WASM are downloaded
 * from version-pinned official sources; source images are not sent to any API.
 * Third-party runtime needs vendoring/integrity checks before clinical use.
 */
export const POSE_SDK_VERSION = "0.10.32";
export const POSE_MODEL_VERSION = "pose_landmarker_lite/float16/1";
export const POSE_BUNDLE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/vision_bundle.mjs";
export const POSE_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm";
export const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

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
  const landmarks = first.map(point => ({
    x: finiteCoordinate(point.x),
    y: finiteCoordinate(point.y),
    z: finiteCoordinate(point.z),
    visibility: Math.max(0, Math.min(1, finiteCoordinate(point.visibility))),
  }));
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

export async function detectPoseOnDevice(file: File): Promise<PoseEstimate> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      !file.size || file.size > 10 * 1024 * 1024) {
    throw new Error("La fotografía no supera la validación local.");
  }
  // Bundled vision runtime downloads only when the user explicitly requests AI.
  // The dynamic URL is pinned; Vite must not try to resolve it during the build.
  const sdkUrl: string = POSE_BUNDLE_URL;
  const vision = await import(/* @vite-ignore */ sdkUrl) as PoseVisionModule;
  const fileset = await vision.FilesetResolver.forVisionTasks(POSE_WASM_URL);
  const landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: "CPU" },
    runningMode: "IMAGE",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    outputSegmentationMasks: false,
  });
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo inicializar el lienzo de análisis.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return summarizePoseResult(landmarker.detect(canvas));
  } finally {
    bitmap?.close();
    landmarker.close();
  }
}
