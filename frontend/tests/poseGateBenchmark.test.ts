import { describe, expect, it } from "vitest";
import type { CaptureReview } from "../src/features/capture/captureQuality";
import { summarizePoseResult } from "../src/features/capture/poseInference";
import { evaluateSyntheticPoseGate, type PoseGateCase } from "../src/features/capture/poseGateBenchmark";

const capture: CaptureReview = {
  width: 900, height: 1300, averageBrightness: 120, contrast: 48, passed: true,
  checks: [
    { id: "resolution", label: "Resolución", passed: true, detail: "Correcto" },
    { id: "illumination", label: "Iluminación", passed: true, detail: "Correcto" },
    { id: "contrast", label: "Contraste", passed: true, detail: "Correcto" },
    { id: "orientation", label: "Encuadre", passed: true, detail: "Correcto" },
  ],
};
function syntheticPose(overrides: Record<number, Partial<{
  x: number; y: number; z: number; visibility: number
}>> = {}) {
  return summarizePoseResult({ landmarks: [
    Array.from({ length: 33 }, (_, index) => ({
      x: 0.3 + 0.4 * (index % 2), y: 0.1 + index * 0.02,
      z: 0, visibility: 0.95, ...overrides[index],
    })),
  ] });
}
const dark: CaptureReview = {
  ...capture, passed: false,
  checks: capture.checks.map(check => check.id === "illumination"
    ? { ...check, passed: false, detail: "Oscura" } : check),
};
const cases: PoseGateCase[] = [
  { id: "full-body", expected: "reviewable", pose: syntheticPose(), capture },
  { id: "missing-ankles", expected: "caution",
    pose: syntheticPose({ 27: { visibility: 0.1 }, 28: { visibility: 0.1 } }), capture },
  { id: "dark", expected: "caution", pose: syntheticPose(), capture: dark },
  { id: "strict-threshold", expected: "insufficient",
    pose: syntheticPose(Object.fromEntries(Array.from({ length: 33 }, (_, i) =>
      [i, { visibility: 0.6 }]))), capture, threshold: 0.85 },
  { id: "no-pose", expected: "not-detected",
    pose: summarizePoseResult({ landmarks: [] }), capture },
  { id: "cropped", expected: "insufficient",
    pose: syntheticPose(Object.fromEntries(Array.from({ length: 30 }, (_, i) =>
      [i + 3, { x: 1.2 }]))), capture },
];

describe("synthetic pose gate benchmark - not clinical accuracy", () => {
  it("evaluates six expected decisions with no unexpected reviewable outcomes", () => {
    const result = evaluateSyntheticPoseGate(cases);
    expect(result.total).toBe(6);
    expect(result.matched).toBe(6);
    expect(result.passRate).toBe(1);
    expect(result.unexpectedReviewable).toBe(0);
  });

  it("reports unsafe promotion to reviewable rather than hiding a regression", () => {
    const broken: PoseGateCase = {
      ...cases[0], id: "unexpected", expected: "caution",
    };
    const result = evaluateSyntheticPoseGate([broken]);
    expect(result.passRate).toBe(0);
    expect(result.unexpectedReviewable).toBe(1);
    expect(result.results[0].actual).toBe("reviewable");
  });

  it("has deterministic empty and duplicate-case behavior", () => {
    expect(evaluateSyntheticPoseGate([])).toMatchObject({
      total: 0, matched: 0, passRate: 0, unexpectedReviewable: 0,
    });
    expect(() => evaluateSyntheticPoseGate([cases[0], cases[0]])).toThrow(/único/);
  });
});
