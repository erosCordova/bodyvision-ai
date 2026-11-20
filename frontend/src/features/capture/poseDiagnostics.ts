/**
 * Optional, local-only technical stage timing for ONE synthetic pose image.
 * These observations stay in component memory. No analytics, upload or storage.
 * Legacy Chromium performance.memory covers JS heap only, NOT WASM, GPU, RSS,
 * device capacity or peak RAM. It may be absent or rounded.
 */
export type PoseStageStamps = {
  started: number;
  validated: number;
  prepared: number;
  modelReady: number;
  inferred: number;
  finished: number;
};

export type PoseLocalDiagnostic = {
  validationMs: number | null;
  preparationMs: number | null;
  modelWaitMs: number | null;
  inferenceMs: number | null;
  cleanupMs: number | null;
  totalMs: number | null;
  modelCachedAtStart: boolean;
  detected: boolean;
  jsHeapBeforeBytes: number | null;
  jsHeapAfterBytes: number | null;
};

const duration = (begin: number, end: number): number | null =>
  Number.isFinite(begin) && Number.isFinite(end) && end >= begin
    ? end - begin : null;

/** Treat untrusted or unsupported memory APIs as unavailable. */
export function optionalJsHeapBytes(source: unknown): number | null {
  if (source === null || typeof source !== "object") return null;
  const heap = (source as { memory?: { usedJSHeapSize?: unknown } }).memory?.usedJSHeapSize;
  return typeof heap === "number" && Number.isSafeInteger(heap) && heap >= 0
    ? heap : null;
}

export function summarizePoseStages(
  stamps: PoseStageStamps,
  data: Pick<PoseLocalDiagnostic,
    "modelCachedAtStart" | "detected" | "jsHeapBeforeBytes" | "jsHeapAfterBytes">,
): PoseLocalDiagnostic {
  return {
    validationMs: duration(stamps.started, stamps.validated),
    preparationMs: duration(stamps.validated, stamps.prepared),
    modelWaitMs: duration(stamps.prepared, stamps.modelReady),
    inferenceMs: duration(stamps.modelReady, stamps.inferred),
    cleanupMs: duration(stamps.inferred, stamps.finished),
    totalMs: duration(stamps.started, stamps.finished),
    ...data,
  };
}
