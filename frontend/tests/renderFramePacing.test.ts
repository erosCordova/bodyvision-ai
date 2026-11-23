import { describe, expect, it } from "vitest";
import {
  RAF_INTERVAL_WINDOW, RAF_SUSPENSION_GAP_MS,
  recordVisibleRafInterval, summarizeRafFrameIntervals,
} from "../src/features/viewer/renderFramePacing";

describe("F6: bounded, opt-in rotation rAF intervals without synthetic FPS", () => {
  it("reports no made-up cadence before a rotating render has two real callbacks", () => {
    const samples: number[] = [];
    const first = recordVisibleRafInterval(samples, null, 500);
    expect(first).toBe(500);
    expect(summarizeRafFrameIntervals(samples)).toEqual({
      rafIntervalCount: 0, rafMedianIntervalMs: null, rafP95IntervalMs: null,
    });
    expect(recordVisibleRafInterval(samples, first, 516)).toBe(516);
    expect(summarizeRafFrameIntervals(samples).rafMedianIntervalMs).toBe(16);
  });

  it("calculates measured nearest-rank median/p95 without FPS estimates", () => {
    const readings = Array.from({ length: 100 }, (_, i) => 100 - i);
    const result = summarizeRafFrameIntervals(readings);
    expect(result).toEqual({
      rafIntervalCount: 100, rafMedianIntervalMs: 50, rafP95IntervalMs: 95,
    });
    expect(readings[0]).toBe(100);
    expect(Object.keys(result).every(name => !name.toLowerCase().includes("fps"))).toBe(true);
  });

  it("keeps exactly the most recent 120 positive callback gaps", () => {
    const samples: number[] = [];
    let last: number | null = null;
    for (let i = 0; i <= 250; i++) {
      last = recordVisibleRafInterval(samples, last, 100 + i * 17);
    }
    expect(samples).toHaveLength(RAF_INTERVAL_WINDOW);
    expect(samples.every(sample => sample === 17)).toBe(true);
    expect(summarizeRafFrameIntervals(samples).rafP95IntervalMs).toBe(17);
  });

  it("skips invalid, backwards and hidden-tab gaps while preserving valid samples", () => {
    const samples: number[] = [];
    let last = recordVisibleRafInterval(samples, null, 100);
    last = recordVisibleRafInterval(samples, last, 116);
    last = recordVisibleRafInterval(samples, last, 110);
    expect(samples).toEqual([16]);
    last = recordVisibleRafInterval(samples, last, 110 + RAF_SUSPENSION_GAP_MS + 1);
    expect(samples).toEqual([16]);
    expect(recordVisibleRafInterval(samples, last, Number.NaN)).toBeNull();
    recordVisibleRafInterval(samples, null, 10000);
    expect(summarizeRafFrameIntervals(samples).rafIntervalCount).toBe(1);
  });

  it("does not mutate the cadence input and discards unsupported samples", () => {
    const source = [30, Infinity, -1, 16, Number.NaN, 2001, 20];
    expect(summarizeRafFrameIntervals(source)).toEqual({
      rafIntervalCount: 3, rafMedianIntervalMs: 20, rafP95IntervalMs: 30,
    });
    expect(source[0]).toBe(30);
  });
});
