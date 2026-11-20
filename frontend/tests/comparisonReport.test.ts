import { describe, expect, it } from "vitest";
import { buildComparisonReport, type ComparisonReportRow } from "../src/features/analytics/comparisonReport";

const profile = "11111111-1111-4111-8111-111111111111";
const otherProfile = "22222222-2222-4222-8222-222222222222";
const old = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  profile_id: profile, metric_code: "weight", value: 70,
  measured_at: "2026-10-01T14:00:00Z", is_current: true, data_type: "OBSERVADO" as const,
};
const recent = {
  ...old, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  measured_at: "2026-11-12T14:00:00Z", value: 77,
};
const context = {
  profileId: profile, profileCode: "DEMO-001", synthetic: true,
  metricCode: "weight", metricLabel: "Peso", unit: "kg",
};

describe("synthetic comparison PDF snapshot", () => {
  it("includes exact source IDs, dates, observed change and generation timestamp", () => {
    const report = buildComparisonReport([recent, old], old.id, recent.id,
      context, new Date("2026-11-19T22:00:00Z"));
    expect(report).toEqual({
      profileCode: "DEMO-001", metricLabel: "Peso", unit: "kg",
      generatedAt: "2026-11-19T22:00:00.000Z",
      from: { id: old.id, measuredAt: old.measured_at, value: 70 },
      to: { id: recent.id, measuredAt: recent.measured_at, value: 77 },
      absoluteChange: 7, percentChange: 10,
    });
    expect(JSON.stringify(report)).not.toContain(otherProfile);
  });

  it("prevents export of a real profile until privacy release", () => {
    expect(buildComparisonReport([old, recent], old.id, recent.id,
      { ...context, synthetic: false }, new Date())).toBeNull();
  });

  it("rejects cross-profile, cross-metric and superseded measurements", () => {
    const wrongProfile: ComparisonReportRow = {
      ...recent, profile_id: otherProfile,
    };
    const wrongMetric: ComparisonReportRow = {
      ...recent, metric_code: "height",
    };
    const oldVersion: ComparisonReportRow = { ...recent, is_current: false };
    for (const bad of [wrongProfile, wrongMetric, oldVersion]) {
      expect(buildComparisonReport([old, bad], old.id, bad.id, context,
        new Date())).toBeNull();
    }
  });

  it("does not silently export duplicated or reverse-order measurements", () => {
    expect(buildComparisonReport([old, recent], recent.id, old.id, context,
      new Date())).toBeNull();
    expect(buildComparisonReport([old], old.id, old.id, context, new Date()))
      .toBeNull();
  });

  it("keeps zero-baseline percent undefined without inventing a percentage", () => {
    const zero = { ...old, value: 0 };
    const report = buildComparisonReport([zero, recent], zero.id, recent.id,
      context, new Date());
    expect(report?.percentChange).toBeNull();
    expect(report?.absoluteChange).toBe(77);
  });

  it("does not export invalid timestamp or non-finite measurements", () => {
    const corrupt = { ...recent, value: Number.POSITIVE_INFINITY };
    expect(buildComparisonReport([old, corrupt], old.id, corrupt.id,
      context, new Date())).toBeNull();
    expect(buildComparisonReport([old, recent], old.id, recent.id, context,
      new Date("invalid"))).toBeNull();
  });
});
