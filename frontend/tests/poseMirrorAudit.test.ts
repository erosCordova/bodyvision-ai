import { describe, expect, it } from "vitest";
import {
  MIN_MIRROR_COMPARISONS, summarizeSyntheticPoseMirror, summarizeSyntheticPoseRepeat,
  type SyntheticPosePoint,
} from "../src/features/capture/poseMirrorAudit";

const original: SyntheticPosePoint[] = Array.from({ length: 33 }, (_, index) => ({
  index, x: 0.20 + index / 100, y: 0.12 + index / 100,
}));
const opposite = [0, 4, 5, 6, 1, 2, 3, 8, 7, 10, 9, 12, 11, 14, 13,
  16, 15, 18, 17, 20, 19, 22, 21, 24, 23, 26, 25, 28, 27, 30, 29, 32, 31];

function reflectedExactly(points: readonly SyntheticPosePoint[]): SyntheticPosePoint[] {
  return points.map(point => ({ index: opposite[point.index], x: 1 - point.x, y: point.y }));
}

describe("real-output comparison under a synthetic horizontal reflection", () => {
  it("compares every MediaPipe landmark with the correct reflected left/right partner", () => {
    const mirrored = reflectedExactly(original);
    expect(summarizeSyntheticPoseMirror(original, mirrored)).toEqual({
      matchedLandmarks: 33, originalVisible: 33, mirroredVisible: 33,
      coverageFraction: 1, medianNormalizedDifference: 0,
      p95NormalizedDifference: 0, sufficientForDescriptiveSummary: true,
      clinicalAccuracyMeasured: false,
    });
    expect(mirrored).toHaveLength(33); // No mutation and no landmarks exported.
  });

  it("reports a nonzero descriptive deviation when mirrored points shift", () => {
    const reflected = reflectedExactly(original).map(p => ({ ...p, y: p.y + 0.1 }));
    const observed = summarizeSyntheticPoseMirror(original, reflected);
    expect(observed.matchedLandmarks).toBe(33);
    expect(observed.p95NormalizedDifference).toBeGreaterThan(0);
    expect(observed.medianNormalizedDifference).toBe(observed.p95NormalizedDifference);
  });

  it("does not manufacture scores for no detection or insufficient visible landmarks", () => {
    expect(summarizeSyntheticPoseMirror([], []).medianNormalizedDifference).toBeNull();
    const few = original.slice(0, MIN_MIRROR_COMPARISONS - 1);
    const report = summarizeSyntheticPoseMirror(few, reflectedExactly(few));
    expect(report.matchedLandmarks).toBe(few.length);
    expect(report.sufficientForDescriptiveSummary).toBe(false);
    expect(report.medianNormalizedDifference).toBeNull();
    expect(report.p95NormalizedDifference).toBeNull();
  });

  it("counts only points with both sides available, without sharing coordinates in output", () => {
    const reflected = reflectedExactly(original).filter(point => point.index < 8);
    const report = summarizeSyntheticPoseMirror(original, reflected);
    expect(report.matchedLandmarks).toBe(8);
    expect(report.sufficientForDescriptiveSummary).toBe(true);
    expect(JSON.stringify(report)).not.toContain("\"x\"");
    expect(JSON.stringify(report)).not.toContain("\"y\"");
    expect(JSON.stringify(report)).not.toContain("landmarks:");
  });

  it("compares repeated inference outputs without suggesting anatomical correctness", () => {
    const same = summarizeSyntheticPoseRepeat(original, [...original].reverse());
    expect(same).toEqual({
      matchedLandmarks: 33, firstVisible: 33, secondVisible: 33,
      medianNormalizedDifference: 0, p95NormalizedDifference: 0,
      sufficientForDescriptiveSummary: true, clinicalAccuracyMeasured: false,
    });
    const shifted = summarizeSyntheticPoseRepeat(original, original.map(point => ({
      ...point, x: point.x + 0.05,
    })));
    expect(shifted.medianNormalizedDifference).toBeGreaterThan(0);
    expect(shifted.p95NormalizedDifference).toBeGreaterThan(0);
    expect(JSON.stringify(shifted)).not.toContain("\"x\"");
    const short = summarizeSyntheticPoseRepeat(original.slice(0, 3), original.slice(0, 3));
    expect(short.p95NormalizedDifference).toBeNull();
    expect(short.matchedLandmarks).toBe(3);
  });

  it("rejects duplicate, off-frame, non-finite and unknown-index landmarks", () => {
    const invalid = [
      [{ ...original[0], index: 33 }],
      [{ ...original[0], index: -1 }],
      [{ ...original[0], x: NaN }],
      [{ ...original[0], x: -0.1 }],
      [{ ...original[0], y: Infinity }],
      [original[0], original[0]],
    ];
    for (const values of invalid) {
      expect(() => summarizeSyntheticPoseMirror(values, [])).toThrow(/inválidos/);
    }
  });
});
