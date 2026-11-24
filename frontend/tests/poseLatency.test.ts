import { describe, expect, it } from "vitest";
import { formatLocalPoseDuration, localPoseLatencyGuidance } from "../src/features/capture/poseLatency";

describe("local pose timing feedback (synthetic only)", () => {
  it("formats milliseconds and seconds without presenting device averages", () => {
    expect(formatLocalPoseDuration(123.6)).toBe("124 ms");
    expect(formatLocalPoseDuration(999)).toBe("999 ms");
    expect(formatLocalPoseDuration(1000)).toBe("1,00 s");
    expect(formatLocalPoseDuration(2650)).toBe("2,65 s");
  });

  it("rejects invalid timing values instead of reporting a false measurement", () => {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatLocalPoseDuration(value)).toBe("No disponible");
      expect(localPoseLatencyGuidance(value)).toMatch(/No fue posible/);
    }
  });

  it("uses meaningful latency hints without claiming diagnostic accuracy", () => {
    expect(localPoseLatencyGuidance(1200)).toMatch(/prueba local/);
    expect(localPoseLatencyGuidance(2500)).toMatch(/dos segundos/);
    expect(localPoseLatencyGuidance(6000)).toMatch(/cinco segundos/);
  });
});
