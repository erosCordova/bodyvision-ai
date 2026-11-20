/**
 * Repeated execution of local pose inference on one synthetic test image.
 * No pixels, landmarks, measurements or device identifiers are recorded.
 * The five-sample p95 is descriptive (nearest rank = slowest observation),
 * not a statistical service-level guarantee or a clinical metric.
 */
export const POSE_BENCHMARK_RUNS = 5;

export type LocalPoseBenchmark = {
  attempts: number;
  successful: number;
  failed: number;
  detected: number;
  timingsMs: number[];
  medianMs: number | null;
  p95Ms: number | null;
};

export function summarizeLocalPoseBenchmark(
  attempts: readonly { elapsedMs: number; detected: boolean; successful: boolean }[],
): LocalPoseBenchmark {
  const timingsMs = attempts
    .filter(item => item.successful && Number.isFinite(item.elapsedMs) && item.elapsedMs >= 0)
    .map(item => item.elapsedMs)
    .sort((a, b) => a - b);
  const successful = attempts.filter(item => item.successful).length;
  const detected = attempts.filter(item => item.successful && item.detected).length;
  const nearestRank = (percentile: number): number | null => timingsMs.length
    ? timingsMs[Math.max(0, Math.ceil(percentile * timingsMs.length) - 1)]
    : null;
  return {
    attempts: attempts.length,
    successful,
    failed: attempts.length - successful,
    detected,
    timingsMs,
    medianMs: nearestRank(0.5),
    p95Ms: nearestRank(0.95),
  };
}

/** Repeat a warm detector with explicit opt-in and abandon stale photos. */
export async function runLocalPoseBenchmark(
  detect: () => Promise<{ found: boolean }>,
  current: () => boolean,
  onProgress: (completed: number) => void,
  options: {
    repetitions?: number;
    now?: () => number;
    yieldBeforeRun?: () => Promise<void>;
  } = {},
): Promise<LocalPoseBenchmark | null> {
  const repetitions = options.repetitions ?? POSE_BENCHMARK_RUNS;
  if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > POSE_BENCHMARK_RUNS) {
    throw new Error("La prueba admite entre una y cinco repeticiones.");
  }
  const now = options.now ?? (() => performance.now());
  const yieldBeforeRun = options.yieldBeforeRun ?? (async () => {});
  const samples: Array<{ elapsedMs: number; successful: boolean; detected: boolean }> = [];
  for (let i = 0; i < repetitions; i++) {
    if (!current()) return null;
    await yieldBeforeRun();
    if (!current()) return null;
    const started = now();
    try {
      const result = await detect();
      if (!current()) return null;
      samples.push({
        elapsedMs: Math.max(0, now() - started),
        successful: true,
        detected: result.found,
      });
    } catch {
      if (!current()) return null;
      samples.push({ elapsedMs: Math.max(0, now() - started), successful: false, detected: false });
    }
    onProgress(i + 1);
  }
  return summarizeLocalPoseBenchmark(samples);
}
