import { describe, expect, it } from "vitest";
import type { CaptureReview } from "../src/features/capture/captureQuality";
import { summarizePoseResult } from "../src/features/capture/poseInference";
import {
  assessPoseQuality, clampVisibilityThreshold, isPosePointVisible,
} from "../src/features/capture/poseQuality";

const goodReview: CaptureReview = {
  width: 900, height: 1300, averageBrightness: 120, contrast: 48, passed: true,
  checks: [
    { id: "resolution", label: "Resolución", passed: true, detail: "Correcta" },
    { id: "illumination", label: "Iluminación", passed: true, detail: "Correcta" },
    { id: "contrast", label: "Contraste", passed: true, detail: "Correcto" },
    { id: "orientation", label: "Encuadre vertical", passed: true, detail: "Correcto" },
  ],
};
function syntheticEstimate(visibility = 0.95) {
  const landmarks = Array.from({ length: 33 }, (_, i) => ({
    x: 0.35 + (i % 2) * 0.3, y: 0.1 + (i / 33) * 0.8, z: 0,
    visibility,
  }));
  return summarizePoseResult({ landmarks: [landmarks] });
}

describe("pose visibility review is not a clinical accuracy score", () => {
  it("clamps a user-defined visibility threshold to meaningful, finite bounds", () => {
    expect(clampVisibilityThreshold(NaN)).toBe(0.5);
    expect(clampVisibilityThreshold(-1)).toBe(0.3);
    expect(clampVisibilityThreshold(1.2)).toBe(0.9);
    expect(isPosePointVisible({ x: 0.2, y: 0.5, z: 0, visibility: 0.75 }, 0.7)).toBe(true);
    expect(isPosePointVisible({ x: -1, y: 0.5, z: 0, visibility: 1 }, 0.5)).toBe(false);
  });
  it("counts all core joints when pose and synthetic capture are visible", () => {
    const review = assessPoseQuality(syntheticEstimate(), goodReview);
    expect(review.visiblePoints).toBe(33);
    expect(review.coreVisible).toBe(8);
    expect(review.coreTotal).toBe(8);
    expect(review.state).toBe("reviewable");
    expect(review.warnings).toEqual([]);
    expect(review.groups.find(g => g.id === "ankles")?.visible).toBe(2);
  });
  it("never labels entirely off-frame model output as a reviewable pose", () => {
    const raw = Array.from({ length: 33 }, () => ({
      x: -0.5, y: 1.6, z: 0, visibility: 0.99,
    }));
    const estimate = summarizePoseResult({ landmarks: [raw] });
    expect(estimate.found).toBe(false);
    const quality = assessPoseQuality(estimate, goodReview);
    expect(quality.state).toBe("not-detected");
    expect(quality.visiblePoints).toBe(0);
    expect(quality.coreVisible).toBe(0);
    expect(quality.warnings).toContain("No se ha detectado una pose humana en esta imagen.");
  });

  it("prevents a collapsed 33-point output from being marked reviewable", () => {
    const degenerate = summarizePoseResult({
      landmarks: [Array.from({ length: 33 }, () => ({
        x: 0.5, y: 0.5, z: 0, visibility: 0.99,
      }))],
    });
    expect(degenerate.found).toBe(true);
    const result = assessPoseQuality(degenerate, goodReview);
    expect(result.coreVisible).toBe(8);
    expect(result.visiblePoints).toBe(33);
    expect(result.state).toBe("insufficient");
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("casi superpuestos"),
    ]));
  });

  it("does not reject a clearly distributed synthetic core skeleton", () => {
    const result = assessPoseQuality(syntheticEstimate(), goodReview);
    expect(result.state).toBe("reviewable");
    expect(result.warnings.some(message => message.includes("superpuestos"))).toBe(false);
  });

  it("exposes low-light warnings without confusing them with landmark quality", () => {
    const lowLight: CaptureReview = {
      ...goodReview, passed: false,
      checks: goodReview.checks.map(check => check.id === "illumination"
        ? { ...check, passed: false, detail: "La foto está demasiado oscura." }
        : check),
    };
    const review = assessPoseQuality(syntheticEstimate(), lowLight);
    expect(review.visiblePoints).toBe(33);
    expect(review.state).toBe("caution");
    expect(review.warnings).toContain("La foto está demasiado oscura.");
  });
  it("does not treat missing ankles as complete body visibility", () => {
    const pose = syntheticEstimate();
    pose.landmarks[27] = { ...pose.landmarks[27], visibility: 0.12 };
    pose.landmarks[28] = { ...pose.landmarks[28], visibility: 0.18 };
    const review = assessPoseQuality(pose, goodReview);
    expect(review.state).toBe("caution");
    expect(review.coreVisible).toBe(6);
    expect(review.groups.find(g => g.id === "ankles")?.state).toBe("missing");
    expect(review.warnings.some(w => w.includes("Faltan"))).toBe(true);
  });
  it("marks an inverted core as caution even when every landmark passes visibility", () => {
    const pose = syntheticEstimate();
    for (const point of pose.landmarks) point.y = 1 - point.y;
    const quality = assessPoseQuality(pose, goodReview);
    expect(quality.visiblePoints).toBe(33);
    expect(quality.state).toBe("caution");
    expect(quality.warnings.some(message => message.includes("invertida"))).toBe(true);
  });
  it("flags key points touching the image boundary without claiming a medical problem", () => {
    const pose = syntheticEstimate();
    pose.landmarks[27].y = 0.992;
    const result = assessPoseQuality(pose, goodReview);
    expect(result.state).toBe("caution");
    expect(result.warnings.some(message => message.includes("borde"))).toBe(true);
  });
  it("flags a compact but high-visibility pose as difficult to review visually", () => {
    const pose = syntheticEstimate();
    for (const point of pose.landmarks) point.y = 0.4 + point.y * 0.15;
    const result = assessPoseQuality(pose, goodReview);
    expect(result.state).toBe("caution");
    expect(result.warnings.some(message => message.includes("poca altura"))).toBe(true);
  });
  it("provides an insufficient classification if most points fall below the threshold", () => {
    const quality = assessPoseQuality(syntheticEstimate(0.55), goodReview, 0.8);
    expect(quality.visiblePoints).toBe(0);
    expect(quality.state).toBe("insufficient");
    expect(quality.groups.every(g => g.state === "missing")).toBe(true);
  });
  it("never reports a body when the model returns no detection", () => {
    const result = assessPoseQuality(summarizePoseResult({ landmarks: [] }), goodReview);
    expect(result.state).toBe("not-detected");
    expect(result.visiblePoints).toBe(0);
    expect(result.warnings).toContain("No se ha detectado una pose humana en esta imagen.");
  });
});
