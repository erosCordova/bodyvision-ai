/**
 * Bounded requestAnimationFrame callback intervals ONLY while an explicitly
 * rotating atlas actually submits WebGL frames. These are browser-scheduling
 * observations, never GPU completion, display FPS or clinical performance.
 */
export const RAF_INTERVAL_WINDOW = 120;
export const RAF_SUSPENSION_GAP_MS = 2000;

export function recordVisibleRafInterval(
  samples: number[],
  previousTimestamp: number | null,
  timestamp: number,
): number | null {
  if (!Number.isFinite(timestamp) || timestamp < 0) return null;
  if (previousTimestamp !== null && Number.isFinite(previousTimestamp)) {
    const interval = timestamp - previousTimestamp;
    // Never treat a hidden/suspended tab gap as steady frame pacing.
    if (interval > 0 && interval <= RAF_SUSPENSION_GAP_MS) {
      samples.push(interval);
      if (samples.length > RAF_INTERVAL_WINDOW) samples.shift();
    }
  }
  return timestamp;
}

export function summarizeRafFrameIntervals(samples: readonly number[]) {
  const valid = samples.filter(n => Number.isFinite(n) && n > 0 && n <= RAF_SUSPENSION_GAP_MS)
    .sort((a, b) => a - b);
  const percentile = (fraction: number) => valid.length
    ? Math.round(valid[Math.ceil(valid.length * fraction) - 1] * 100) / 100
    : null;
  return {
    rafIntervalCount: valid.length,
    rafMedianIntervalMs: percentile(0.5),
    rafP95IntervalMs: percentile(0.95),
  };
}
