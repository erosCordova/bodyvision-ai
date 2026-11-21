import { describe, expect, it } from "vitest";
import {
  recordRenderCpuSample, RENDER_CPU_WINDOW, summarizeRenderCpuSamples,
} from "../src/features/viewer/renderCpuTiming";

describe("bounded 3D CPU submission measurements", () => {
  it("reports no fabricated metrics when the viewport has never rendered", () => {
    expect(summarizeRenderCpuSamples([])).toEqual({
      cpuSampleCount: 0, cpuMedianMs: null, cpuP95Ms: null,
    });
  });

  it("derives real nearest-rank median and p95, not an FPS estimate", () => {
    const values = Array.from({ length: 100 }, (_, i) => 100 - i);
    const stats = summarizeRenderCpuSamples(values);
    expect(stats).toEqual({ cpuSampleCount: 100, cpuMedianMs: 50, cpuP95Ms: 95 });
    expect(values[0]).toBe(100); // No mutation of the input.
  });

  it("retains at most the latest 120 valid samples", () => {
    const samples: number[] = [];
    for (let i = 1; i <= 250; i++) recordRenderCpuSample(samples, i);
    expect(samples.length).toBe(RENDER_CPU_WINDOW);
    expect(samples[0]).toBe(131);
    expect(samples.at(-1)).toBe(250);
    expect(summarizeRenderCpuSamples(samples)).toEqual({
      cpuSampleCount: 120, cpuMedianMs: 190, cpuP95Ms: 244,
    });
  });

  it("omits invalid and negative timings while retaining zero-duration samples", () => {
    const samples = [2];
    for (const value of [NaN, Infinity, -Infinity, -1]) recordRenderCpuSample(samples, value);
    recordRenderCpuSample(samples, 0);
    expect(samples).toEqual([2, 0]);
    expect(summarizeRenderCpuSamples(samples).cpuP95Ms).toBe(2);
  });
});
