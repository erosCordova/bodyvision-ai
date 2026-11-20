/**
 * Privacy-minimal export of experimental pose review on synthetic images.
 * Never serialize filenames, raw coordinates, media bytes, URLs or arbitrary
 * free-form capture warnings. A review state is not diagnostic accuracy.
 */
import type { CaptureReview } from "./captureQuality";
import { POSE_MODEL_VERSION, type PoseEstimate } from "./poseInference";
import {
  clampVisibilityThreshold, POSE_REVIEW_GROUPS, type PoseQuality,
} from "./poseQuality";

const states = ["not-detected", "insufficient", "caution", "reviewable"] as const;

export function buildSyntheticPoseReviewReport(input: {
  capture: CaptureReview;
  pose: PoseEstimate;
  quality: PoseQuality;
  threshold: number;
}) {
  const boundedCount = (value: number, limit: number) =>
    Number.isSafeInteger(value) ? Math.max(0, Math.min(limit, value)) : 0;
  const check = (id: CaptureReview["checks"][number]["id"]) =>
    input.capture.checks.find(item => item.id === id)?.passed ?? null;
  const state = states.includes(input.quality.state) ? input.quality.state : "insufficient";
  const detected = input.pose.found === true;
  return {
    schemaVersion: 1,
    reportKind: "bodyvision-synthetic-pose-review",
    evidence: "local-browser-synthetic-review",
    clinicalAccuracyValidated: false,
    containsPhoto: false,
    containsLandmarks: false,
    containsIdentifiers: false,
    capture: {
      passed: input.capture.passed === true,
      checks: {
        resolution: check("resolution"),
        illumination: check("illumination"),
        contrast: check("contrast"),
        orientation: check("orientation"),
      },
    },
    pose: {
      detected,
      model: POSE_MODEL_VERSION,
      threshold: clampVisibilityThreshold(input.threshold),
      result: detected ? state : "not-detected",
      visiblePoints: detected ? boundedCount(input.quality.visiblePoints, 33) : 0,
      coreVisible: detected ? boundedCount(input.quality.coreVisible, 8) : 0,
      coreTotal: 8,
      groups: POSE_REVIEW_GROUPS.map(group => {
        const count = input.quality.groups.find(item => item.id === group.id)?.visible ?? 0;
        return {
          zone: group.id,
          visible: detected ? boundedCount(count, group.landmarks.length) : 0,
          total: group.landmarks.length,
        };
      }),
    },
    limitations: [
      "Revisión heurística de visibilidad y encuadre, no precisión anatómica.",
      "No se ha validado con personas ni con un corpus independiente.",
      "El archivo se crea localmente y solo ante una descarga explícita.",
    ],
  };
}

export function downloadSyntheticPoseReviewReport(input: Parameters<typeof buildSyntheticPoseReviewReport>[0]) {
  const json = JSON.stringify(buildSyntheticPoseReviewReport(input), null, 2) + "\n";
  const url = URL.createObjectURL(new Blob([json], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "bodyvision-revision-pose-sintetica.json";
  try {
    anchor.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}
