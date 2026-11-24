/**
 * Bounded CPU WebGL command-submission samples. These numbers do NOT measure
 * GPU completion, screen refresh rate, user-visible latency or FPS.
 */
export const RENDER_CPU_WINDOW = 120;

export function recordRenderCpuSample(samples: number[], elapsedMs: number): void {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return;
  samples.push(elapsedMs);
  if (samples.length > RENDER_CPU_WINDOW) samples.shift();
}

export function summarizeRenderCpuSamples(samples: readonly number[]) {
  const ordered = samples.filter(value => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  const percentile = (ratio: number) => ordered.length
    ? Math.round(ordered[Math.max(0, Math.ceil(ordered.length * ratio) - 1)] * 100) / 100
    : null;
  return {
    cpuSampleCount: ordered.length,
    cpuMedianMs: percentile(0.5),
    cpuP95Ms: percentile(0.95),
  };
}
