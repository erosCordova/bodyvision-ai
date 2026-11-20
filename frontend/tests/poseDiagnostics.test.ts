import { describe, expect, it } from "vitest";
import { optionalJsHeapBytes, summarizePoseStages } from "../src/features/capture/poseDiagnostics";

describe("local-only technical pose diagnostics", () => {
  it("reports separately recorded stages, without fabricating device timings", () => {
    expect(summarizePoseStages({
      started: 10, validated: 30, prepared: 110,
      modelReady: 250, inferred: 290, finished: 295,
    }, {
      modelCachedAtStart: false, detected: true,
      jsHeapBeforeBytes: null, jsHeapAfterBytes: null,
    })).toEqual({
      validationMs: 20, preparationMs: 80, modelWaitMs: 140,
      inferenceMs: 40, cleanupMs: 5, totalMs: 285,
      modelCachedAtStart: false, detected: true,
      jsHeapBeforeBytes: null, jsHeapAfterBytes: null,
    });
  });

  it("reports missing times rather than changing reversed or invalid clocks into zero", () => {
    const stats = summarizePoseStages({
      started: Number.NaN, validated: 30, prepared: 20,
      modelReady: 60, inferred: Number.POSITIVE_INFINITY, finished: 100,
    }, {
      modelCachedAtStart: true, detected: false,
      jsHeapBeforeBytes: null, jsHeapAfterBytes: null,
    });
    expect(stats.validationMs).toBeNull();
    expect(stats.preparationMs).toBeNull();
    expect(stats.modelWaitMs).toBe(40);
    expect(stats.inferenceMs).toBeNull();
    expect(stats.cleanupMs).toBeNull();
    expect(stats.totalMs).toBeNull();
  });

  it("reads only a valid optional JS heap field, never pretending it is physical RAM", () => {
    expect(optionalJsHeapBytes({ memory: { usedJSHeapSize: 24_000_000 } }))
      .toBe(24_000_000);
    expect(optionalJsHeapBytes({})).toBeNull();
    expect(optionalJsHeapBytes(null)).toBeNull();
    expect(optionalJsHeapBytes({ memory: { usedJSHeapSize: -2 } })).toBeNull();
    expect(optionalJsHeapBytes({ memory: { usedJSHeapSize: "24000000" } })).toBeNull();
    expect(optionalJsHeapBytes({ memory: { usedJSHeapSize: 1.5 } })).toBeNull();
    expect(optionalJsHeapBytes({ memory: { usedJSHeapSize: Number.POSITIVE_INFINITY } }))
      .toBeNull();
  });
});
