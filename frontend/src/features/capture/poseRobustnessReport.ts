/**
 * Descriptive CI-only evaluation of locally detected landmarks on synthetically
 * transformed screenshots of the BODYVISION atlas. No patient data, thresholds
 * for clinical inference, device identifiers or images are retained in reports.
 */
export const SYNTHETIC_POSE_DECISIONS = [
  "Sin detección",
  "Puntos insuficientes",
  "Requiere revisión",
  "Visible para revisión visual",
] as const;

export type SyntheticPoseDecision = typeof SYNTHETIC_POSE_DECISIONS[number];

export type SyntheticPoseObservation = {
  condition: string;
  detected: boolean;
  quality: SyntheticPoseDecision;
  capturePassed: boolean;
  failedChecks: string[];
};

export type SyntheticPoseMatrixSummary = {
  total: number;
  detected: number;
  notDetected: number;
  detectionFraction: number | null;
  reviewable: number;
  caution: number;
  insufficient: number;
  failedCapture: number;
  failedCaptureReviewable: number;
  inconsistentDetection: number;
};

/**
 * Counts review-gate regressions; does not compute classification accuracy.
 * For example, a detected pose is not evidence that its coordinates are right.
 */
export function summarizeSyntheticPoseMatrix(
  observations: readonly SyntheticPoseObservation[],
): SyntheticPoseMatrixSummary {
  const conditions = new Set<string>();
  for (const observation of observations) {
    if (!observation.condition.trim() || conditions.has(observation.condition)) {
      throw new Error("La matriz sintética requiere condiciones únicas y no vacías.");
    }
    if (!SYNTHETIC_POSE_DECISIONS.includes(observation.quality)) {
      throw new Error("Estado de revisión no reconocido.");
    }
    if (observation.capturePassed !== (observation.failedChecks.length === 0)) {
      throw new Error("La condición de captura no coincide con las alertas registradas.");
    }
    conditions.add(observation.condition);
  }
  const count = (predicate: (item: SyntheticPoseObservation) => boolean): number =>
    observations.filter(predicate).length;
  const detected = count(item => item.detected);
  return {
    total: observations.length,
    detected,
    notDetected: observations.length - detected,
    detectionFraction: observations.length ? detected / observations.length : null,
    reviewable: count(item => item.quality === "Visible para revisión visual"),
    caution: count(item => item.quality === "Requiere revisión"),
    insufficient: count(item => item.quality === "Puntos insuficientes"),
    failedCapture: count(item => !item.capturePassed),
    failedCaptureReviewable: count(item =>
      !item.capturePassed && item.quality === "Visible para revisión visual"),
    inconsistentDetection: count(item =>
      item.detected === (item.quality === "Sin detección")),
  };
}
