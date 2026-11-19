import type { Measurement } from "../../services/api/records";

export type ComparisonPoint = Pick<
  Measurement,
  "id" | "metric_code" | "value" | "measured_at" | "is_current"
>;

export function chronologicalMeasurements<T extends ComparisonPoint>(rows: T[]): T[] {
  return rows
    .filter((row) =>
      row.is_current &&
      Number.isFinite(row.value) &&
      Number.isFinite(Date.parse(row.measured_at)),
    )
    .slice()
    .sort((a, b) =>
      Date.parse(a.measured_at) - Date.parse(b.measured_at) ||
      a.id.localeCompare(b.id),
    );
}

/** Compare two observed records only; never merge with 3D simulated values. */
export function compareMeasurements(
  rows: ComparisonPoint[],
  fromId: string,
  toId: string,
) {
  const from = rows.find((row) => row.id === fromId);
  const to = rows.find((row) => row.id === toId);
  if (
    !from || !to || !from.is_current || !to.is_current ||
    from.id === to.id || from.metric_code !== to.metric_code ||
    !Number.isFinite(from.value) || !Number.isFinite(to.value) ||
    !Number.isFinite(Date.parse(from.measured_at)) ||
    !Number.isFinite(Date.parse(to.measured_at)) ||
    Date.parse(from.measured_at) >= Date.parse(to.measured_at)
  ) return null;

  const absoluteChange = to.value - from.value;
  const percentChange = from.value === 0
    ? null
    : (absoluteChange / Math.abs(from.value)) * 100;
  return { from, to, absoluteChange, percentChange };
}
