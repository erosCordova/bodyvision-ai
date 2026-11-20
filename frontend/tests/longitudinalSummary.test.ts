import { describe, expect, it } from "vitest";
import {
  summarizeLongitudinal, type LongitudinalRow,
} from "../src/features/analytics/longitudinalSummary";

const profileId = "11111111-1111-4111-8111-111111111111";
const context = { profileId, metricCode: "weight" };
const base: LongitudinalRow = {
  id: "one", profile_id: profileId, metric_code: "weight",
  value: 70, measured_at: "2026-11-01T12:00:00Z", is_current: true,
  data_type: "OBSERVADO", outlier_confirmed: false, method: "manual",
};
const middle = { ...base, id: "two", value: 72,
  measured_at: "2026-11-03T12:00:00Z" };
const recent = { ...base, id: "three", value: 80,
  measured_at: "2026-11-04T12:00:00Z" };

describe("longitudinal descriptive summary", () => {
  it("computes median, range and ordered first-to-last difference", () => {
    expect(summarizeLongitudinal([recent, base, middle], context)).toMatchObject({
      count: 3, median: 72, minimum: 70, maximum: 80,
      first: { id: "one" }, last: { id: "three" },
      absoluteChange: 10, percentChange: (10 / 70) * 100,
      gapCount: 0, outlierCount: 0, mixedMethods: false,
    });
  });
  it("uses the mean of central values for even sample counts", () => {
    expect(summarizeLongitudinal([base, recent], context)?.median).toBe(75);
  });
  it("rejects mixed profiles, metrics, simulated and superseded rows", () => {
    const contaminated = [
      { ...middle, id: "x", profile_id: "someone-else" },
      { ...middle, id: "y", metric_code: "height" },
      { ...middle, id: "z", data_type: "SIMULADO" },
      { ...middle, id: "s", is_current: false },
    ];
    expect(summarizeLongitudinal([base, recent, ...contaminated], context)?.count)
      .toBe(2);
    expect(summarizeLongitudinal(contaminated, context)).toBeNull();
  });
  it("does not double count IDs or invalid numeric/date observations", () => {
    const corrupt = [
      { ...middle, id: "badval", value: Number.POSITIVE_INFINITY },
      { ...middle, id: "baddate", measured_at: "invalid" },
      { ...base },
    ];
    expect(summarizeLongitudinal([base, recent, ...corrupt], context)?.count).toBe(2);
  });
  it("reports gaps, atipicals and mixed methods, not interpolated values", () => {
    const flagged = { ...recent, outlier_confirmed: true, method: "device" as const,
      measured_at: "2026-11-10T12:00:00Z" };
    expect(summarizeLongitudinal([base, flagged], context)).toMatchObject({
      count: 2, gapCount: 1, outlierCount: 1, mixedMethods: true,
    });
  });
  it("does not invent a percentage from zero or a change at one timestamp", () => {
    const zero = { ...base, value: 0 };
    expect(summarizeLongitudinal([zero, recent], context)).toMatchObject({
      absoluteChange: 80, percentChange: null,
    });
    expect(summarizeLongitudinal([base], context)).toMatchObject({
      count: 1, absoluteChange: null, percentChange: null,
    });
    expect(summarizeLongitudinal([base, { ...recent, measured_at: base.measured_at }],
      context)?.absoluteChange).toBeNull();
  });
});
