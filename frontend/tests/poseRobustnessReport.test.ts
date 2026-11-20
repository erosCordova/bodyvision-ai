import { describe, expect, it } from "vitest";
import {
  summarizeSyntheticPoseMatrix,
  type SyntheticPoseObservation,
} from "../src/features/capture/poseRobustnessReport";

const example: SyntheticPoseObservation[] = [
  { condition: "front", detected: true, quality: "Visible para revisión visual",
    capturePassed: true, failedChecks: [] },
  { condition: "low-light", detected: true, quality: "Requiere revisión",
    capturePassed: false, failedChecks: ["Iluminación"] },
  { condition: "occlusion", detected: false, quality: "Sin detección",
    capturePassed: true, failedChecks: [] },
  { condition: "cropped", detected: true, quality: "Puntos insuficientes",
    capturePassed: false, failedChecks: ["Encuadre vertical"] },
];

describe("synthetic pose matrix summary (never clinical accuracy)", () => {
  it("counts actual outcomes and local warnings without estimating model precision", () => {
    expect(summarizeSyntheticPoseMatrix(example)).toEqual({
      total: 4, detected: 3, notDetected: 1, detectionFraction: 0.75,
      reviewable: 1, caution: 1, insufficient: 1, failedCapture: 2,
      failedCaptureReviewable: 0, inconsistentDetection: 0,
    });
  });
  it("reports unsafe promotion rather than silently accepting failed capture", () => {
    const mismatch: SyntheticPoseObservation = { ...example[1],
      quality: "Visible para revisión visual" };
    expect(summarizeSyntheticPoseMatrix([mismatch]).failedCaptureReviewable).toBe(1);
  });
  it("reports mismatches between model detection and the status label", () => {
    const mismatch: SyntheticPoseObservation = { ...example[2],
      quality: "Requiere revisión" };
    expect(summarizeSyntheticPoseMatrix([mismatch]).inconsistentDetection).toBe(1);
  });
  it("handles empty observations without fabricating a detection rate", () => {
    expect(summarizeSyntheticPoseMatrix([])).toMatchObject({
      total: 0, detectionFraction: null, detected: 0,
      failedCaptureReviewable: 0, inconsistentDetection: 0,
    });
  });
  it("rejects duplicate/blank names, unknown decisions and inconsistent warnings", () => {
    expect(() => summarizeSyntheticPoseMatrix([example[0], example[0]])).toThrow(/únicas/);
    expect(() => summarizeSyntheticPoseMatrix([{ ...example[0], condition: " " }]))
      .toThrow(/no vacías/);
    expect(() => summarizeSyntheticPoseMatrix([{ ...example[0],
      quality: "Invalid decision" as SyntheticPoseObservation["quality"] }]))
      .toThrow(/no reconocido/);
    expect(() => summarizeSyntheticPoseMatrix([{ ...example[1], capturePassed: true }]))
      .toThrow(/no coincide/);
  });
});
