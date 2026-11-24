import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { Measurement } from "../../services/api/records";
import { EmptyState } from "../../components/ui/States";
import { DataTypeBadge } from "../../components/ui/DataTypeBadge";
export function HistoryChart({
  rows,
  unit,
}: {
  rows: Measurement[];
  unit: string;
}) {
  const points = useMemo(() => {
    const data: { time: number; value: number | null }[] = [];
    rows.forEach((row, index) => {
      const time = Date.parse(row.measured_at);
      if (
        index &&
        (time - Date.parse(rows[index - 1].measured_at) > 48 * 3600000 ||
          row.method !== rows[index - 1].method || row.unit !== rows[index - 1].unit)
      )
        data.push({
          time: (time + Date.parse(rows[index - 1].measured_at)) / 2,
          value: null,
        });
      data.push({ time, value: row.unit === unit ? row.value : null });
    });
    return data;
  }, [rows, unit]);
  if (!rows.length)
    return <EmptyState text="No hay mediciones en este periodo" />;
  const date = (value: number) =>
    new Intl.DateTimeFormat("es-PE", {
      timeZone: "America/Lima",
      day: "2-digit",
      month: "short",
    }).format(new Date(value));
  return (
    <section
      className="panel chart-panel"
      aria-label="Evolución de mediciones observadas"
    >
      <div className="section-title">
        <h2>Evolución ({unit})</h2>
        <DataTypeBadge type="OBSERVADO" />
      </div>
      <p className="muted">
        Los huecos superiores a 48 horas y los cambios de método no se conectan. Cada punto corresponde a una medición vigente; consulta las fuentes en el historial.
      </p>
      <div
        className="chart"
        role="img"
        aria-label={`Gráfico con ${rows.length} mediciones. Los mismos valores están disponibles en la tabla del historial.`}
      >
        <ResponsiveContainer width="100%" height={280}>
          <LineChart
            data={points}
            margin={{ top: 15, right: 20, bottom: 10, left: 0 }}
            accessibilityLayer
          >
            <CartesianGrid stroke="#28435f" strokeDasharray="3 3" />
            <XAxis
              dataKey="time"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={date}
              stroke="#9FB3C8"
              tick={{ fontSize: 11 }}
            />
            <YAxis
              domain={["auto", "auto"]}
              stroke="#9FB3C8"
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              labelFormatter={(value) => date(Number(value))}
              contentStyle={{
                background: "#0F2238",
                border: "1px solid #1B3A5C",
              }}
            />
            <Line
              type="linear"
              dataKey="value"
              name={unit}
              stroke="#22D3EE"
              strokeWidth={2}
              dot={{ r: 4, fill: "#22D3EE" }}
              activeDot={{ r: 6 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
