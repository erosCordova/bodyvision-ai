import { useMemo } from "react";
import type { Measurement } from "../../services/api/records";
import { DataTypeBadge } from "../../components/ui/DataTypeBadge";
import { summarizeLongitudinal } from "./longitudinalSummary";

const number = (value: number) => new Intl.NumberFormat("es-PE", {
  maximumFractionDigits: 2,
}).format(value);
const signed = (value: number) => new Intl.NumberFormat("es-PE", {
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
}).format(value);

export function LongitudinalSummary({
  rows, profileId, metricCode, unit,
}: {
  rows: Measurement[];
  profileId: string;
  metricCode: string;
  unit: string;
}) {
  const summary = useMemo(() =>
    summarizeLongitudinal(rows, { profileId, metricCode }),
  [rows, profileId, metricCode]);

  return (
    <section className="panel chart-panel longitudinal-summary"
      aria-labelledby="longitudinal-summary-title">
      <div className="section-title">
        <h2 id="longitudinal-summary-title">Resumen del periodo</h2>
        <DataTypeBadge type="DERIVADO" />
      </div>
      <p className="muted">
        Estadísticas descriptivas de mediciones observadas vigentes, de una única
        métrica y expediente. No incluyen simulaciones, interpolaciones ni
        predicciones clínicas.
      </p>
      {!summary ? (
        <p role="status" className="muted">
          No hay mediciones observadas válidas en este periodo.
        </p>
      ) : (
        <>
          <div className="derived-grid longitudinal-summary-grid" role="group"
            aria-label="Estadísticas del periodo seleccionado">
            <article>
              <span className="muted">Mediana</span>
              <strong>{number(summary.median)} {unit}</strong>
              <small className="muted">Valor central, sin ponderación temporal</small>
            </article>
            <article>
              <span className="muted">Mínimo / máximo</span>
              <strong>{number(summary.minimum)} / {number(summary.maximum)} {unit}</strong>
              <small className="muted">Valores observados en el periodo</small>
            </article>
            <article>
              <span className="muted">Registros válidos</span>
              <strong>{summary.count}</strong>
              <small className="muted">Sin versiones sustituidas ni IDs duplicados</small>
            </article>
          </div>
          <p className="muted longitudinal-summary-detail">
            {summary.absoluteChange === null ? (
              "No es posible calcular un cambio entre fechas distintas con los registros disponibles."
            ) : (
              <>
                Diferencia del primer al último registro:{" "}
                <strong>{signed(summary.absoluteChange)} {unit}</strong>
                {summary.percentChange === null
                  ? " (porcentaje no calculable con base cero)."
                  : ` (${signed(summary.percentChange)} % respecto al valor inicial).`}
              </>
            )}
            {" "}Cobertura cronológica: {number(summary.spanDays)} días.
            {summary.gapCount > 0 &&
              ` Hay ${summary.gapCount} intervalo(s) de más de 48 horas sin interpolar.`}
            {summary.outlierCount > 0 &&
              ` ${summary.outlierCount} registro(s) señalados como atípicos confirmados.`}
            {summary.mixedMethods &&
              " Se combinaron métodos manual y de dispositivo; interpreta la diferencia con precaución."}
            {summary.count < 3 &&
              " Muestra pequeña: no se puede inferir una tendencia."}
          </p>
        </>
      )}
    </section>
  );
}
