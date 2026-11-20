import type { Measurement } from "../../services/api/records";

export type LongitudinalRow = Pick<Measurement,
  "id" | "profile_id" | "metric_code" | "value" | "measured_at" |
  "is_current" | "outlier_confirmed" | "method"
> & { data_type: string };

export type LongitudinalSummaryResult = {
  count: number;
  median: number;
  minimum: number;
  maximum: number;
  first: { id: string; measuredAt: string; value: number };
  last: { id: string; measuredAt: string; value: number };
  absoluteChange: number | null;
  percentChange: number | null;
  spanDays: number;
  gapCount: number;
  outlierCount: number;
  mixedMethods: boolean;
};

/**
 * Descriptive statistics from already-authorized observed measurements only.
 * Not an estimate of health, body composition, growth or a prediction.
 * No interpolation across missing days; no persistence or extra API requests.
 */
export function summarizeLongitudinal(
  rows: LongitudinalRow[],
  context: { profileId: string; metricCode: string },
): LongitudinalSummaryResult | null {
  if (!context.profileId || !context.metricCode) return null;
  const ids = new Set<string>();
  const selected = rows.filter(row => {
    if (row.profile_id !== context.profileId ||
        row.metric_code !== context.metricCode ||
        row.data_type !== "OBSERVADO" || !row.is_current ||
        !row.id || !Number.isFinite(row.value) ||
        !Number.isFinite(Date.parse(row.measured_at)) ||
        ids.has(row.id)) return false;
    ids.add(row.id);
    return true;
  }).sort((a, b) => Date.parse(a.measured_at) - Date.parse(b.measured_at) ||
    a.id.localeCompare(b.id));
  if (!selected.length) return null;

  const values = selected.map(row => row.value).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2
    ? values[middle]
    : (values[middle - 1] / 2 + values[middle] / 2);
  const first = selected[0];
  const last = selected[selected.length - 1];
  const firstTime = Date.parse(first.measured_at);
  const lastTime = Date.parse(last.measured_at);
  const comparable = selected.length > 1 && lastTime > firstTime;
  const absoluteChange = comparable ? last.value - first.value : null;
  const percentChange = comparable && first.value !== 0 && absoluteChange !== null
    ? (absoluteChange / Math.abs(first.value)) * 100
    : null;
  let gapCount = 0;
  for (let index = 1; index < selected.length; index += 1) {
    if (Date.parse(selected[index].measured_at) -
        Date.parse(selected[index - 1].measured_at) > 48 * 3600000) gapCount += 1;
  }
  if (!Number.isFinite(median) || (absoluteChange !== null &&
      !Number.isFinite(absoluteChange)) ||
      (percentChange !== null && !Number.isFinite(percentChange))) return null;

  return {
    count: selected.length,
    median,
    minimum: values[0],
    maximum: values[values.length - 1],
    first: { id: first.id, measuredAt: first.measured_at, value: first.value },
    last: { id: last.id, measuredAt: last.measured_at, value: last.value },
    absoluteChange,
    percentChange,
    spanDays: (lastTime - firstTime) / 86400000,
    gapCount,
    outlierCount: selected.filter(row => row.outlier_confirmed).length,
    mixedMethods: new Set(selected.map(row => row.method)).size > 1,
  };
}
