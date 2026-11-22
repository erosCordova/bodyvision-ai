import { useEffect, useMemo, useRef, useState } from "react";
import { saveLongitudinalCsv, verifiedLongitudinalCsv, type LongitudinalDownload } from "./serverLongitudinalExport";
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
  rows, profileId, metricCode, unit, period, exportReport,
}: {
  rows: Measurement[];
  profileId: string;
  metricCode: string;
  unit: string;
  period: "30d" | "90d" | "1a" | "all";
  exportReport?: () => Promise<LongitudinalDownload>;
}) {
  const [busy, setBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    setExportError("");
    setBusy(false);
    return () => { generation.current += 1; };
  }, [profileId, metricCode, period]);
  const exportCsv = async () => {
    if (!exportReport || busy) return;
    const token = ++generation.current;
    setBusy(true);
    setExportError("");
    try {
      const data = await exportReport();
      const blob = await verifiedLongitudinalCsv(data);
      if (generation.current === token) saveLongitudinalCsv(blob, data.filename);
    } catch (error) {
      if (generation.current === token)
        setExportError(error instanceof Error ? error.message : "No se pudo descargar el CSV.");
    } finally {
      if (generation.current === token) setBusy(false);
    }
  };
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
          {exportReport && <div className="record-report-actions">
            <button type="button" onClick={() => void exportCsv()} disabled={busy}>
              {busy ? "Preparando historial…" : "Descargar historial observado (CSV)"}
            </button>
            <small className="muted">Historial completo del periodo, hasta 8 MiB por archivo,
              con auditoría y verificación de integridad. No es una firma digital
              ni acredita exactitud clínica.</small>
          </div>}
          {exportError && <p role="alert">{exportError}</p>}
        </>
      )}
    </section>
  );
}
