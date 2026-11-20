import { describe, expect, it } from "vitest";
import { buildSyntheticPoseReviewReport } from "../src/features/capture/poseReviewReport";
import { assessPoseQuality } from "../src/features/capture/poseQuality";
import { summarizePoseResult } from "../src/features/capture/poseInference";
import type { CaptureReview } from "../src/features/capture/captureQuality";

const capture: CaptureReview = {
  width: 900, height: 1200, averageBrightness: 100, contrast: 40, passed: true,
  checks: [
    { id: "resolution", label: "Resolución", detail: "Secreto de archivo", passed: true },
    { id: "illumination", label: "Luz", detail: "Referencia privada", passed: true },
    { id: "contrast", label: "Contraste", detail: "OK", passed: true },
    { id: "orientation", label: "Orientación", detail: "OK", passed: true },
  ],
};
const pose = summarizePoseResult({ landmarks: [Array.from({ length: 33 }, (_, index) => ({
  x: 0.3 + (index % 2) * 0.4,
  y: 0.12 + index * 0.022,
  z: 0,
  visibility: 0.95,
}))] });

describe("explicit synthetic pose quality report", () => {
  it("keeps only predefined counts and flags; no image, landmarks, names or free-form details", () => {
    const quality = assessPoseQuality(pose, capture);
    const captureWithPrivateField = { ...capture, privateName: "SECRET_PATIENT" };
    const poseWithPrivateFields = { ...pose, photo: "data:image/png;private", fileName: "NAME.png" };
    const result = buildSyntheticPoseReviewReport({
      capture: captureWithPrivateField,
      pose: poseWithPrivateFields,
      quality: { ...quality, warnings: ["PRIVATE_WARNING"] },
      threshold: 0.5,
    });
    expect(result).toMatchObject({
      reportKind: "bodyvision-synthetic-pose-review",
      clinicalAccuracyValidated: false,
      containsPhoto: false,
      containsLandmarks: false,
      containsIdentifiers: false,
      capture: { passed: true, checks: { resolution: true } },
      pose: { detected: true, visiblePoints: 33, coreVisible: 8,
        result: "reviewable", threshold: 0.5 },
    });
    expect(result.pose.groups).toHaveLength(7);
    const json = JSON.stringify(result);
    for (const secret of ["SECRET_PATIENT", "PRIVATE_WARNING", "Secreto de archivo",
      "Referencia privada", "NAME.png", "data:image/png", "\"landmarks\""]) {
      expect(json).not.toContain(secret);
    }
    expect(Object.keys(result.pose)).toEqual([
      "detected", "model", "threshold", "result", "visiblePoints", "coreVisible", "coreTotal", "groups",
    ]);
  });
  it("does not invent body points for an empty pose and bounds malicious numerical values", () => {
    const missing = summarizePoseResult({ landmarks: [] });
    const quality = assessPoseQuality(missing, capture);
    const report = buildSyntheticPoseReviewReport({
      capture, pose: missing,
      quality: { ...quality, visiblePoints: Number.POSITIVE_INFINITY,
        coreVisible: -999, groups: [] },
      threshold: Number.NaN,
    });
    expect(report.pose).toMatchObject({
      detected: false, result: "not-detected", visiblePoints: 0,
      coreVisible: 0, threshold: 0.5,
    });
    expect(report.pose.groups.every(group => group.visible === 0)).toBe(true);
  });
});
