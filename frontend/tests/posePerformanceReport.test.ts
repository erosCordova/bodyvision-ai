import { describe, expect, it } from "vitest";
import {
  buildSyntheticPosePerformanceReport, serializeSyntheticPosePerformanceReport,
} from "../src/features/capture/posePerformanceReport";
import type { CaptureReview } from "../src/features/capture/captureQuality";
import type { LocalPoseBenchmark } from "../src/features/capture/poseDeviceBenchmark";
import type { PoseLocalDiagnostic } from "../src/features/capture/poseDiagnostics";

const capture: CaptureReview = {
  width: 800, height: 1177, contrast: 38, averageBrightness: 100, passed: true,
  checks: [
    { id: "resolution", label: "Resolución", passed: true, detail: "Pasa" },
    { id: "illumination", label: "Iluminación", passed: true, detail: "Pasa" },
    { id: "contrast", label: "Contraste", passed: true, detail: "Pasa" },
    { id: "orientation", label: "Vertical", passed: true, detail: "Pasa" },
  ],
};
const benchmark: LocalPoseBenchmark = {
  attempts: 5, successful: 4, failed: 1, detected: 3,
  timingsMs: [12.124, 14.5, 16.75, 18],
  medianMs: 15.625, p95Ms: 18,
};
const diagnostic: PoseLocalDiagnostic = {
  validationMs: 2.3333, preparationMs: 20, modelWaitMs: 3, inferenceMs: 55,
  cleanupMs: 1, totalMs: 81.33, modelCachedAtStart: true, detected: true,
  jsHeapBeforeBytes: null, jsHeapAfterBytes: null,
};

describe("synthetic performance report, explicit export only", () => {
  it("exports only allowlisted numeric and boolean measurements, never sensitive inputs", () => {
    const entry = {
      capture: { ...capture, fullImage: "base64:SENSITIVE", imageFileName: "patient.png" },
      detected: true, singleRunMs: 125.1234, benchmark: {
        ...benchmark, photoPixels: [99, 102], rawLandmarks: [1, 2, 3],
      },
      diagnostic: { ...diagnostic, fileName: "identifying-photo.png", userAgent: "secret" },
      accessToken: "private-token",
      name: "PERSONAL-IDENTIFIER",
    };
    const json = serializeSyntheticPosePerformanceReport(entry);
    const output = JSON.parse(json);
    expect(output).toMatchObject({
      schemaVersion: 1,
      reportKind: "bodyvision-local-pose-performance",
      evidence: "synthetic-image-browser-observation",
      actualMobileHardwareVerified: false,
      containsPhoto: false, containsLandmarks: false,
      capture: { widthPx: 800, heightPx: 1177, qualityPassed: true },
      pose: { detected: true, firstTotalMs: 125.12 },
      warmBenchmark: { attempts: 5, successful: 4, failed: 1, detected: 3,
        sampleTimingsMs: [12.12, 14.5, 16.75, 18], medianMs: 15.63, p95Ms: 18 },
      stageDiagnostic: { jsHeapBeforeBytes: null, jsHeapAfterBytes: null },
    });
    for (const forbidden of ["patient.png", "SENSITIVE", "private-token", "PERSONAL-IDENTIFIER",
      "rawLandmarks", "photoPixels", "identifying-photo.png", "secret"]) {
      expect(json).not.toContain(forbidden);
    }
    expect(Object.keys(output)).toEqual([
      "schemaVersion", "reportKind", "evidence", "actualMobileHardwareVerified",
      "containsPhoto", "containsLandmarks", "capture", "pose",
      "warmBenchmark", "stageDiagnostic", "limitations",
    ]);
  });

  it("supports partial reports without fabricating missing benchmark or memory values", () => {
    const result = buildSyntheticPosePerformanceReport({
      capture, detected: false, singleRunMs: null,
      benchmark: null, diagnostic: null,
    });
    expect(result.warmBenchmark).toBeNull();
    expect(result.stageDiagnostic).toBeNull();
    expect(result.pose).toEqual({ detected: false, firstTotalMs: null });
  });

  it("turns invalid durations into null and never exports arbitrary check details", () => {
    const result = buildSyntheticPosePerformanceReport({
      capture: { ...capture, checks: capture.checks.map(check => ({
        ...check, detail: "sensitive-note",
      })) },
      detected: true, singleRunMs: Number.POSITIVE_INFINITY,
      benchmark: { ...benchmark, medianMs: Number.NaN, timingsMs: [Number.NaN] },
      diagnostic: { ...diagnostic, totalMs: -1 },
    });
    expect(result.pose.firstTotalMs).toBeNull();
    expect(result.warmBenchmark?.medianMs).toBeNull();
    expect(result.warmBenchmark?.sampleTimingsMs).toEqual([null]);
    expect(result.stageDiagnostic?.totalMs).toBeNull();
    expect(JSON.stringify(result)).not.toContain("sensitive-note");
  });
});
