import { describe, expect, it } from "vitest";
import type { CaptureReview } from "../src/features/capture/captureQuality";
import { summarizePoseResult } from "../src/features/capture/poseInference";
import { assessPoseQuality } from "../src/features/capture/poseQuality";

const capture: CaptureReview = {
  width: 900, height: 1300, averageBrightness: 120, contrast: 50, passed: true,
  checks: [
    { id: "resolution", label: "Resolución", passed: true, detail: "Correcta" },
    { id: "illumination", label: "Iluminación", passed: true, detail: "Correcta" },
    { id: "contrast", label: "Contraste", passed: true, detail: "Correcta" },
    { id: "orientation", label: "Orientación", passed: true, detail: "Correcta" },
  ],
};

function poseWith(overrides: Record<number, Partial<{
  x: number; y: number; z: number; visibility: number
}>> = {}) {
  const points = Array.from({ length: 33 }, (_, index) => ({
    x: 0.3 + (index % 2) * 0.4,
    y: 0.12 + index * 0.022,
    z: 0,
    visibility: 0.95,
    ...overrides[index],
  }));
  return summarizePoseResult({ landmarks: [points] });
}

describe("phase 5: deterministic synthetic pose validation matrix", () => {
  it("accepts only a visible synthetic full-body pose for experimental review", () => {
    const pose = poseWith();
    expect(pose.fullBodyReview).toBe(true);
    expect(assessPoseQuality(pose, capture).state).toBe("reviewable");
  });

  it("flags ankle occlusion even when 31 other landmarks remain visible", () => {
    const pose = poseWith({ 27: { visibility: 0.05 }, 28: { visibility: 0.05 } });
    const quality = assessPoseQuality(pose, capture);
    expect(pose.fullBodyReview).toBe(false);
    expect(quality.state).toBe("caution");
    expect(quality.groups.find(group => group.id === "ankles")?.state).toBe("missing");
  });

  it("rejects a largely cropped body rather than assuming complete visibility", () => {
    const crop = Object.fromEntries(
      Array.from({ length: 28 }, (_, index) => [index + 5, { y: 1.2 }]),
    );
    const quality = assessPoseQuality(poseWith(crop), capture);
    expect(quality.visiblePoints).toBe(5);
    expect(quality.state).toBe("insufficient");
  });

  it("applies a stricter visibility threshold without changing model output", () => {
    const pose = poseWith({ 11: { visibility: 0.6 }, 12: { visibility: 0.6 } });
    const normal = assessPoseQuality(pose, capture, 0.5);
    const stricter = assessPoseQuality(pose, capture, 0.8);
    expect(normal.state).toBe("reviewable");
    expect(stricter.coreVisible).toBe(6);
    expect(stricter.state).toBe("caution");
  });

  it("marks low illumination as caution even with all landmarks visible", () => {
    const dark: CaptureReview = {
      ...capture, passed: false,
      checks: capture.checks.map(check => check.id === "illumination"
        ? { ...check, passed: false, detail: "Iluminación insuficiente" } : check),
    };
    const quality = assessPoseQuality(poseWith(), dark);
    expect(quality.state).toBe("caution");
    expect(quality.warnings).toContain("Iluminación insuficiente");
  });

  it("does not present an empty or malformed detection as a body", () => {
    for (const landmarks of [[], [{ x: 0.5, y: 0.5 }]]) {
      const pose = summarizePoseResult({ landmarks: [landmarks] });
      expect(pose.found).toBe(false);
      expect(assessPoseQuality(pose, capture).state).toBe("not-detected");
    }
  });

  it("filters non-finite coordinates without treating their fallback as a detected joint", () => {
    const pose = poseWith({ 23: { x: Number.NaN }, 24: { y: Infinity } });
    const quality = assessPoseQuality(pose, capture);
    expect(quality.coreVisible).toBe(6);
    expect(quality.state).toBe("caution");
    expect(pose.landmarks.every(point => Object.values(point).every(Number.isFinite))).toBe(true);
  });
});
