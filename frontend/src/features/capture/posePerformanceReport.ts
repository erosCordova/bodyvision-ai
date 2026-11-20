/**
 * An intentionally minimal, downloadable protocol for synthetic-only browser
 * performance observations. This module constructs a new allowlisted object:
 * never serialize MediaPipe landmarks, photos, file names, user agents,
 * network endpoints, device identifiers, browser history or arbitrary state.
 */
import type { CaptureReview } from "./captureQuality";
import type { LocalPoseBenchmark } from "./poseDeviceBenchmark";
import type { PoseLocalDiagnostic } from "./poseDiagnostics";

export type SyntheticPosePerformanceInput = {
  capture: CaptureReview;
  detected: boolean;
  singleRunMs: number | null;
  benchmark: LocalPoseBenchmark | null;
  diagnostic: PoseLocalDiagnostic | null;
};

const milliseconds = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 100) / 100 : null;

const checkPassed = (
  capture: CaptureReview,
  id: CaptureReview["checks"][number]["id"],
): boolean | null => capture.checks.find(check => check.id === id)?.passed ?? null;

export function buildSyntheticPosePerformanceReport(input: SyntheticPosePerformanceInput) {
  return {
    schemaVersion: 1,
    reportKind: "bodyvision-local-pose-performance",
    evidence: "synthetic-image-browser-observation",
    actualMobileHardwareVerified: false,
    containsPhoto: false,
    containsLandmarks: false,
    capture: {
      widthPx: Number.isSafeInteger(input.capture.width) && input.capture.width > 0
        ? input.capture.width : null,
      heightPx: Number.isSafeInteger(input.capture.height) && input.capture.height > 0
        ? input.capture.height : null,
      qualityPassed: input.capture.passed === true,
      checks: {
        resolution: checkPassed(input.capture, "resolution"),
        illumination: checkPassed(input.capture, "illumination"),
        contrast: checkPassed(input.capture, "contrast"),
        orientation: checkPassed(input.capture, "orientation"),
      },
    },
    pose: {
      detected: input.detected === true,
      firstTotalMs: milliseconds(input.singleRunMs),
    },
    // A prepared-image warm benchmark is not interchangeable with end-to-end
    // timing. Null means this user has not run that additional opt-in test.
    warmBenchmark: input.benchmark === null ? null : {
      attempts: input.benchmark.attempts,
      successful: input.benchmark.successful,
      failed: input.benchmark.failed,
      detected: input.benchmark.detected,
      sampleTimingsMs: input.benchmark.timingsMs.map(value => milliseconds(value)),
      medianMs: milliseconds(input.benchmark.medianMs),
      p95Ms: milliseconds(input.benchmark.p95Ms),
    },
    stageDiagnostic: input.diagnostic === null ? null : {
      validationMs: milliseconds(input.diagnostic.validationMs),
      preparationMs: milliseconds(input.diagnostic.preparationMs),
      modelWaitMs: milliseconds(input.diagnostic.modelWaitMs),
      inferenceMs: milliseconds(input.diagnostic.inferenceMs),
      cleanupMs: milliseconds(input.diagnostic.cleanupMs),
      totalMs: milliseconds(input.diagnostic.totalMs),
      modelCachedAtStart: input.diagnostic.modelCachedAtStart === true,
      detected: input.diagnostic.detected === true,
      // Only optional approximate JS heap snapshots; not physical phone RAM.
      jsHeapBeforeBytes: input.diagnostic.jsHeapBeforeBytes,
      jsHeapAfterBytes: input.diagnostic.jsHeapAfterBytes,
    },
    limitations: [
      "No se demuestra que el ensayo corresponda a un dispositivo físico.",
      "Los tiempos son observaciones locales, no garantías de rendimiento.",
      "El heap JavaScript no equivale a memoria RAM, GPU ni WebAssembly.",
      "Las imágenes sintéticas no validan exactitud clínica.",
    ],
  };
}

export function serializeSyntheticPosePerformanceReport(input: SyntheticPosePerformanceInput): string {
  return JSON.stringify(buildSyntheticPosePerformanceReport(input), null, 2) + "\n";
}

/**
 * Create and save the report only after an explicit user click. Nothing is
 * sent to the server. The caller must have confirmed a synthetic source.
 */
export function downloadSyntheticPosePerformanceReport(input: SyntheticPosePerformanceInput): void {
  const blob = new Blob([serializeSyntheticPosePerformanceReport(input)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "bodyvision-rendimiento-local-sintetico.json";
  try {
    anchor.click();
  } finally {
    // Defer revocation so mobile download managers can resolve the blob URL.
    const revoke = URL.revokeObjectURL.bind(URL);
    window.setTimeout(() => revoke(url), 1500);
  }
}
