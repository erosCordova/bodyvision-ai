import type { Measurement } from "../../services/api/records";
import { chronologicalMeasurements, compareMeasurements } from "./measurementComparison";

export type ComparisonReportRow = Pick<Measurement,
  "id" | "profile_id" | "metric_code" | "value" | "measured_at" | "is_current" | "data_type"
>;

export type ComparisonReport = {
  profileCode: string;
  metricLabel: string;
  unit: string;
  generatedAt: string;
  from: { id: string; measuredAt: string; value: number };
  to: { id: string; measuredAt: string; value: number };
  absoluteChange: number;
  percentChange: number | null;
};

/**
 * Restrict client-side export to already-authorized synthetic observations
 * of exactly one profile and metric. Never include corrections or 3D scenarios.
 * Report authenticity/signatures and export audit need separate server-side review.
 */
export function buildComparisonReport(
  rows: ComparisonReportRow[],
  fromId: string,
  toId: string,
  context: {
    profileId: string;
    profileCode: string;
    synthetic: boolean;
    metricCode: string;
    metricLabel: string;
    unit: string;
  },
  generatedAt: Date,
): ComparisonReport | null {
  if (!context.synthetic || !context.profileId || !context.profileCode.trim() ||
      !context.metricCode || !Number.isFinite(generatedAt.getTime())) return null;
  const selected = chronologicalMeasurements(rows.filter(row =>
    row.data_type === "OBSERVADO" &&
    row.profile_id === context.profileId &&
    row.metric_code === context.metricCode,
  ));
  const difference = compareMeasurements(selected, fromId, toId);
  if (!difference) return null;
  return {
    profileCode: context.profileCode,
    metricLabel: context.metricLabel,
    unit: context.unit,
    generatedAt: generatedAt.toISOString(),
    from: {
      id: difference.from.id,
      measuredAt: difference.from.measured_at,
      value: difference.from.value,
    },
    to: {
      id: difference.to.id,
      measuredAt: difference.to.measured_at,
      value: difference.to.value,
    },
    absoluteChange: difference.absoluteChange,
    percentChange: difference.percentChange,
  };
}
