import { describe, expect, it } from "vitest";
import {
  chronologicalMeasurements,
  compareMeasurements,
  type ComparisonPoint,
} from "../src/features/analytics/measurementComparison";

const point = (
  id: string,
  date: string,
  value: number,
  metric_code = "weight",
  is_current = true,
): ComparisonPoint => ({
  id, metric_code, measured_at: date, value, is_current,
});

describe("observed measurements between dates", () => {
  const old = point("old", "2026-10-01T12:00:00Z", 70);
  const recent = point("recent", "2026-11-10T12:00:00Z", 77);
  it("orders by actual timestamps, not response order", () => {
    expect(chronologicalMeasurements([recent, old]).map((row) => row.id))
      .toEqual(["old", "recent"]);
  });
  it("computes a signed absolute and relative change", () => {
    expect(compareMeasurements([recent, old], "old", "recent")).toMatchObject({
      absoluteChange: 7,
      percentChange: 10,
    });
    expect(compareMeasurements([old, recent], "recent", "old")).toBeNull();
  });
  it("refuses duplicate timestamps, mismatched metrics and superseded records", () => {
    expect(compareMeasurements([old, point("same", old.measured_at, 71)], "old", "same"))
      .toBeNull();
    expect(compareMeasurements([old, point("height", recent.measured_at, 175, "height")], "old", "height"))
      .toBeNull();
    expect(compareMeasurements([old, point("obsolete", recent.measured_at, 80, "weight", false)], "old", "obsolete"))
      .toBeNull();
    expect(chronologicalMeasurements([old, point("obsolete", recent.measured_at, 80, "weight", false)]))
      .toHaveLength(1);
  });
  it("never divides by zero", () => {
    expect(compareMeasurements([point("zero", old.measured_at, 0), recent], "zero", "recent")?.percentChange)
      .toBeNull();
  });
  it("does not infer a change from a single observation or invalid dates", () => {
    expect(compareMeasurements([old], "old", "missing")).toBeNull();
    expect(chronologicalMeasurements([point("bad", "not-a-date", 70)])).toEqual([]);
  });
});
