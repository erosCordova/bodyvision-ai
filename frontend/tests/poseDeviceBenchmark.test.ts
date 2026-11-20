import { describe, expect, it } from "vitest";
import {
  POSE_BENCHMARK_RUNS, runLocalPoseBenchmark, summarizeLocalPoseBenchmark,
} from "../src/features/capture/poseDeviceBenchmark";

describe("local synthetic pose repeatability benchmark", () => {
  it("uses median and nearest-rank p95 on five successful executions", () => {
    const summary = summarizeLocalPoseBenchmark([
      { elapsedMs: 500, successful: true, detected: true },
      { elapsedMs: 150, successful: true, detected: true },
      { elapsedMs: 320, successful: true, detected: false },
      { elapsedMs: 100, successful: true, detected: true },
      { elapsedMs: 200, successful: true, detected: true },
    ]);
    expect(POSE_BENCHMARK_RUNS).toBe(5);
    expect(summary).toMatchObject({
      attempts: 5, successful: 5, failed: 0, detected: 4,
      medianMs: 200, p95Ms: 500,
    });
    expect(summary.timingsMs).toEqual([100, 150, 200, 320, 500]);
  });

  it("excludes failures and invalid timings from latency percentiles", () => {
    const summary = summarizeLocalPoseBenchmark([
      { elapsedMs: 200, successful: true, detected: true },
      { elapsedMs: 1500, successful: false, detected: false },
      { elapsedMs: Number.NaN, successful: true, detected: true },
      { elapsedMs: 100, successful: true, detected: false },
    ]);
    expect(summary).toMatchObject({
      attempts: 4, successful: 3, failed: 1, detected: 2,
      medianMs: 100, p95Ms: 200,
    });
    expect(summary.timingsMs).toEqual([100, 200]);
  });

  it("reports null latency rather than inventing measurements when all runs fail", () => {
    expect(summarizeLocalPoseBenchmark([])).toMatchObject({
      attempts: 0, successful: 0, failed: 0, medianMs: null, p95Ms: null,
    });
    expect(summarizeLocalPoseBenchmark([
      { elapsedMs: 90, successful: false, detected: false },
    ])).toMatchObject({ attempts: 1, failed: 1, medianMs: null, p95Ms: null });
  });

  it("runs five serial detections and records progress only while current", async () => {
    let clock = 0;
    let calls = 0;
    const progress: number[] = [];
    const result = await runLocalPoseBenchmark(async () => {
      calls++;
      clock += calls * 100;
      return { found: calls !== 4 };
    }, () => true, done => progress.push(done), { now: () => clock });
    expect(calls).toBe(5);
    expect(progress).toEqual([1, 2, 3, 4, 5]);
    expect(result).toMatchObject({
      attempts: 5, successful: 5, failed: 0, detected: 4,
      medianMs: 300, p95Ms: 500,
    });
  });

  it("counts model errors and continues the rest of the synthetic trial", async () => {
    let calls = 0;
    let clock = 0;
    const result = await runLocalPoseBenchmark(async () => {
      calls++;
      clock += 60;
      if (calls === 2) throw Error("simulated model failure");
      return { found: true };
    }, () => true, () => {}, { repetitions: 3, now: () => clock });
    expect(result).toMatchObject({
      attempts: 3, successful: 2, failed: 1, detected: 2,
      medianMs: 60, p95Ms: 60,
    });
  });

  it("abandons in-flight work when its photo or component is no longer current", async () => {
    let active = true;
    let count = 0;
    const progress: number[] = [];
    const result = await runLocalPoseBenchmark(async () => {
      count++;
      active = false;
      return { found: true };
    }, () => active, n => progress.push(n));
    expect(result).toBeNull();
    expect(count).toBe(1);
    expect(progress).toEqual([]);
  });

  it("does not begin detection after becoming stale during yield", async () => {
    let count = 0;
    const result = await runLocalPoseBenchmark(async () => {
      count++;
      return { found: true };
    }, () => count === 0, () => {}, {
      yieldBeforeRun: async () => { count = 2; },
    });
    expect(result).toBeNull();
    expect(count).toBe(2);
  });

  it("rejects invalid repetition limits before calling the model", async () => {
    for (const repetitions of [0, 6, 1.5]) {
      await expect(runLocalPoseBenchmark(async () => ({ found: true }), () => true, () => {}, {
        repetitions,
      })).rejects.toThrow(/cinco/);
    }
  });
});
