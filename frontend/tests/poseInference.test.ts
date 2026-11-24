import { describe, expect, it } from "vitest";
import {
  POSE_EDGES, POSE_MODEL_VERSION, summarizePoseResult,
} from "../src/features/capture/poseInference";

describe("MediaPipe pose result parsing", () => {
  it("never invents a body if the actual model finds nothing", () => {
    const result = summarizePoseResult({ landmarks: [] });
    expect(result.found).toBe(false);
    expect(result.landmarks).toEqual([]);
    expect(result.visiblePoints).toBe(0);
    expect(result.fullBodyReview).toBe(false);
    expect(result.model).toBe(POSE_MODEL_VERSION);
  });

  it("rejects partial detection arrays instead of drawing fabricated joints", () => {
    const result = summarizePoseResult({ landmarks: [[{ x: 0.5, y: 0.5 }]] });
    expect(result.found).toBe(false);
    expect(result.landmarks).toHaveLength(0);
  });

  it("parses 33 actual MediaPipe landmarks with a bounded visibility threshold", () => {
    const landmarks = Array.from({ length: 33 }, (_, index) => ({
      x: index % 2 ? 0.4 : 0.6, y: 0.5,
      z: 0.03, visibility: 0.98,
    }));
    const found = summarizePoseResult({ landmarks: [landmarks] });
    expect(found.found).toBe(true);
    expect(found.visiblePoints).toBe(33);
    expect(found.fullBodyReview).toBe(true);
    expect(found.landmarks).toHaveLength(33);
    expect(POSE_EDGES.length).toBeGreaterThan(20);
    landmarks[27] = { x: 1.5, y: 0.5, z: 0.03, visibility: 0.98 };
    const clipped = summarizePoseResult({ landmarks: [landmarks] });
    expect(clipped.visiblePoints).toBe(32);
    expect(clipped.fullBodyReview).toBe(false);
  });

  it("does not mistake 33 empty coordinate objects for a detected human", () => {
    const incomplete = summarizePoseResult({
      landmarks: [Array.from({ length: 33 }, () => ({}))],
    });
    expect(incomplete.found).toBe(false);
    expect(incomplete.landmarks).toEqual([]);
  });

  it("does not report a body when all 33 finite coordinates are off-screen", () => {
    const offscreen = Array.from({ length: 33 }, () => ({
      x: 1.5, y: -0.2, z: 0.1, visibility: 0.99,
    }));
    const summary = summarizePoseResult({ landmarks: [offscreen] });
    expect(summary).toEqual({
      found: false, landmarks: [], visiblePoints: 0,
      fullBodyReview: false, model: POSE_MODEL_VERSION,
    });
  });

  it("rejects malformed result containers instead of accessing non-array landmarks", () => {
    for (const malformed of [
      null,
      { landmarks: "not-a-pose" },
      { landmarks: [{ length: 33 }] },
      { landmarks: ["x".repeat(33)] },
    ]) {
      const parsed = summarizePoseResult(
        malformed as unknown as Parameters<typeof summarizePoseResult>[0],
      );
      expect(parsed.found).toBe(false);
      expect(parsed.landmarks).toEqual([]);
    }
  });

  it("keeps a legitimate single in-frame point but never claims full-body review", () => {
    const mixed = Array.from({ length: 33 }, () => ({
      x: -2, y: 3, z: 0, visibility: 0.98,
    }));
    mixed[23] = { x: 0.4, y: 0.6, z: 0, visibility: 0.85 };
    const partial = summarizePoseResult({ landmarks: [mixed] });
    expect(partial.found).toBe(true);
    expect(partial.visiblePoints).toBe(1);
    expect(partial.fullBodyReview).toBe(false);
    expect(partial.landmarks).toHaveLength(33);
  });

  it("retains partial-but-valid output for an explicit insufficient review", () => {
    const landmarks = Array.from({ length: 33 }, () => ({ x: NaN, y: Infinity, visibility: 1 }));
    landmarks[0] = { x: 0.5, y: 0.5, visibility: 0.85 };
    const partial = summarizePoseResult({ landmarks: [landmarks] });
    expect(partial.found).toBe(true);
    expect(partial.visiblePoints).toBe(1);
    expect(partial.fullBodyReview).toBe(false);
    expect(partial.landmarks.every(point => Object.values(point).every(Number.isFinite))).toBe(true);
  });

  it("never propagates non-finite positions or confidence scores into an overlay", () => {
    const result = summarizePoseResult({
      landmarks: [Array.from({ length: 33 }, () => ({
        x: NaN, y: Infinity, z: -Infinity, visibility: 12,
      }))],
    });
    expect(result.found).toBe(false);
    expect(result.landmarks).toEqual([]);
    expect(result.visiblePoints).toBe(0);
    expect(result.fullBodyReview).toBe(false);
  });
});
