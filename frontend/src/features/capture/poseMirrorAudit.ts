/**
 * Descriptive mirror-equivariance audit for the same SYNTHETIC atlas image.
 * No patient coordinates or pixels may be written to disk: only the summary.
 * A low geometric deviation is NOT evidence of landmark correctness or
 * human anatomical accuracy; this only compares two model outputs.
 */
export type SyntheticPosePoint = { index: number; x: number; y: number };

const MIRRORED_PAIRS = [
  [0, 0], [1, 4], [2, 5], [3, 6], [7, 8], [9, 10],
  [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22],
  [23, 24], [25, 26], [27, 28], [29, 30], [31, 32],
] as const;

export const POSE_LANDMARK_COUNT = 33;
export const MIN_MIRROR_COMPARISONS = 8;

const counterpart = Array.from({ length: POSE_LANDMARK_COUNT }, (_, index) => index);
for (const [left, right] of MIRRORED_PAIRS) {
  counterpart[left] = right;
  counterpart[right] = left;
}

function indexVisiblePoints(points: readonly SyntheticPosePoint[]): Map<number, SyntheticPosePoint> {
  const values = new Map<number, SyntheticPosePoint>();
  for (const point of points) {
    if (!Number.isSafeInteger(point.index) || point.index < 0 ||
      point.index >= POSE_LANDMARK_COUNT || !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) || point.x < 0 || point.x > 1 ||
      point.y < 0 || point.y > 1 || values.has(point.index)) {
      throw new Error("Los puntos sintéticos de pose tienen índices o posiciones inválidos.");
    }
    values.set(point.index, point);
  }
  return values;
}

const rounded = (value: number) => Math.round(value * 10000) / 10000;

/**
 * Normalized image-diagonal distance after left/right landmark permutation.
 * Null for fewer than eight matched points; even a non-null value is
 * descriptive, with NO threshold for diagnostic or automated acceptance.
 */
export function summarizeSyntheticPoseMirror(
  original: readonly SyntheticPosePoint[],
  reflected: readonly SyntheticPosePoint[],
) {
  const originalByIndex = indexVisiblePoints(original);
  const reflectedByIndex = indexVisiblePoints(reflected);
  const distances: number[] = [];
  for (let index = 0; index < POSE_LANDMARK_COUNT; index++) {
    const a = originalByIndex.get(index);
    const b = reflectedByIndex.get(counterpart[index]);
    if (a && b) distances.push(Math.hypot(a.x - (1 - b.x), a.y - b.y) / Math.SQRT2);
  }
  distances.sort((a, b) => a - b);
  const sufficient = distances.length >= MIN_MIRROR_COMPARISONS;
  return {
    matchedLandmarks: distances.length,
    originalVisible: originalByIndex.size,
    mirroredVisible: reflectedByIndex.size,
    coverageFraction: rounded(distances.length / POSE_LANDMARK_COUNT),
    medianNormalizedDifference: sufficient
      ? rounded(distances[Math.floor((distances.length - 1) / 2)]) : null,
    p95NormalizedDifference: sufficient
      ? rounded(distances[Math.ceil(distances.length * 0.95) - 1]) : null,
    sufficientForDescriptiveSummary: sufficient,
    clinicalAccuracyMeasured: false,
  };
}

/**
 * Repetition comparison of the same synthetic image in one warm model session.
 * Counts only landmarks actually shown in both runs; never persists points.
 * No real-image accuracy or landmark correctness can be inferred.
 */
export function summarizeSyntheticPoseRepeat(
  first: readonly SyntheticPosePoint[],
  second: readonly SyntheticPosePoint[],
) {
  const a = indexVisiblePoints(first);
  const b = indexVisiblePoints(second);
  const distances: number[] = [];
  for (let index = 0; index < POSE_LANDMARK_COUNT; index++) {
    const before = a.get(index);
    const after = b.get(index);
    if (before && after) {
      distances.push(Math.hypot(before.x - after.x, before.y - after.y) / Math.SQRT2);
    }
  }
  distances.sort((x, y) => x - y);
  const sufficient = distances.length >= MIN_MIRROR_COMPARISONS;
  return {
    matchedLandmarks: distances.length,
    firstVisible: a.size,
    secondVisible: b.size,
    medianNormalizedDifference: sufficient
      ? rounded(distances[Math.floor((distances.length - 1) / 2)]) : null,
    p95NormalizedDifference: sufficient
      ? rounded(distances[Math.ceil(distances.length * 0.95) - 1]) : null,
    sufficientForDescriptiveSummary: sufficient,
    clinicalAccuracyMeasured: false,
  };
}
