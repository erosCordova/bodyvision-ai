import type { CaptureReview } from "./captureQuality";
import type { PoseEstimate } from "./poseInference";
import { assessPoseQuality, type PoseQuality } from "./poseQuality";

/**
 * Synthetic-only regression metrics for the *review gate*, not model accuracy.
 * Ground truth represents an expected UI decision supplied by a test author,
 * not an annotated human landmark reference.
 */
export type PoseGateCase = {
  id: string;
  expected: PoseQuality["state"];
  pose: PoseEstimate;
  capture: CaptureReview;
  threshold?: number;
};

export type PoseGateBenchmark = {
  total: number;
  matched: number;
  passRate: number;
  unexpectedReviewable: number;
  results: Array<{
    id: string;
    expected: PoseQuality["state"];
    actual: PoseQuality["state"];
    matched: boolean;
    visiblePoints: number;
    coreVisible: number;
  }>;
};

export function evaluateSyntheticPoseGate(cases: readonly PoseGateCase[]): PoseGateBenchmark {
  const seen = new Set<string>();
  const results = cases.map(item => {
    if (!item.id.trim() || seen.has(item.id)) {
      throw new Error("Cada caso sintético necesita un identificador único.");
    }
    seen.add(item.id);
    const quality = assessPoseQuality(item.pose, item.capture, item.threshold);
    return {
      id: item.id,
      expected: item.expected,
      actual: quality.state,
      matched: quality.state === item.expected,
      visiblePoints: quality.visiblePoints,
      coreVisible: quality.coreVisible,
    };
  });
  const matched = results.filter(item => item.matched).length;
  return {
    total: results.length,
    matched,
    passRate: results.length ? matched / results.length : 0,
    unexpectedReviewable: results.filter(item =>
      item.actual === "reviewable" && item.expected !== "reviewable").length,
    results,
  };
}
