import { useEffect, useMemo, useRef, useState } from "react";
import { saveLongitudinalCsv, verifiedLongitudinalCsv, validExportRange, type ExportDateRange, type LongitudinalDownload } from "./serverLongitudinalExport";
import type { Measurement } from "../../services/api/records";
import { DataTypeBadge } from "../../components/ui/DataTypeBadge";
import { summarizeLongitudinal } from "./longitudinalSummary";
import { verifySavedReportFile, type SavedReportReference } from "./savedReportVerification";
import { saveReportReceipt } from "./reportReceipt";

const number = (value: number) => new Intl.NumberFormat("es-PE", {
  maximumFractionDigits: 2,
}).format(value);
const signed = (value: number) => new Intl.NumberFormat("es-PE", {
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
}).format(value);

export function LongitudinalSummary({
  rows, profileId, metricCode, unit, period, selectedRange, exportReport,
}: {
  rows: Measurement[];
  profileId: string;
  metricCode: string;
  unit: string;
  period: "30d" | "90d" | "1a" | "all" | "custom";
  selectedRange?: ExportDateRange;
  exportReport?: (range?: ExportDateRange) => Promise<LongitudinalDownload>;
}) {
  const [busy, setBusy] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [verificationPending, setVerificationPending] = useState(false);
  const [savedCopyStatus, setSavedCopyStatus] = useState("");
  const [downloadProof, setDownloadProof] = useState<SavedReportReference | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const [exportError, setExportError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    setExportError("");
    setBusy(false);
    setVerificationPending(false);
    setSavedCopyStatus("");
    setDownloadProof(null);
    setStartDate(""); setEndDate("");
    return () => { generation.current += 1; };
  }, [profileId, metricCode, period]);
  const exportCsv = async (range?: ExportDateRange) => {
    if (!exportReport || busy) return;
    const token = ++generation.current;
    setBusy(true);
    setExportError("");
    try {
      const data = range ? await exportReport(range) : await exportReport();
      if (range && (data.period !== "custom" || data.start_date !== range.start_date || data.end_date !== range.end_date))
        throw new Error("El archivo recibido no corresponde a las fechas solicitadas.");
      const blob = await verifiedLongitudinalCsv(data);
      if (generation.current === token) {
        saveLongitudinalCsv(blob, data.filename);
        setDownloadProof({ filename: data.filename, sha256: data.sha256, format: "csv", receipt: data.receipt });
        setSavedCopyStatus("");
      }
    } catch (error) {
      if (generation.current === token)
        setExportError(error instanceof Error ? error.message : "No se pudo descargar el CSV.");
    } finally {
      if (generation.current === token) setBusy(false);
    }
  };
  const checkSavedFile = async (file?: File) => {
    if (!file || !downloadProof || verificationPending) return;
    const token = generation.current;
    setVerificationPending(true);
    setSavedCopyStatus("");
    try {
      await verifySavedReportFile(file, downloadProof);
      if (token === generation.current)
        setSavedCopyStatus("Copia CSV verificada desde el archivo guardado en este equipo.");
    } catch (error) {
      if (token === generation.current)
        setSavedCopyStatus(error instanceof Error ? error.message : "No se pudo verificar la copia guardada.");
    } finally {
      if (token === generation.current) setVerificationPending(false);
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
        </>
      )}
          {exportReport && <div className="record-report-actions">
            <button type="button" onClick={() => void exportCsv(selectedRange)} disabled={busy}>
              {busy ? "Preparando historial…" : "Descargar historial observado (CSV)"}
            </button>
            <small className="muted">Historial completo del periodo, hasta 8 MiB por archivo,
              con auditoría y verificación de integridad. La firma criptográfica opcional no acredita exactitud clínica ni validez legal.</small>
            <details>
              <summary>Exportar un intervalo personalizado</summary>
              <p className="muted">Fechas inclusivas según hora de Lima. Solo cambia el CSV, no el gráfico.
                Reduce el intervalo si el historial completo supera 8 MiB.</p>
              <label>Fecha inicial del CSV
                <input type="date" value={startDate} disabled={busy}
                  onChange={event => setStartDate(event.currentTarget.value)} />
              </label>
              <label>Fecha final del CSV
                <input type="date" value={endDate} disabled={busy}
                  onChange={event => setEndDate(event.currentTarget.value)} />
              </label>
              <button type="button" disabled={busy || !validExportRange({ start_date: startDate, end_date: endDate })}
                onClick={() => void exportCsv({ start_date: startDate, end_date: endDate })}>
                Descargar CSV por fechas
              </button>
            </details>
            {downloadProof && <>
                {downloadProof.receipt && <>
                  <button type="button" onClick={() => {
                    if (downloadProof.receipt) saveReportReceipt(downloadProof.receipt);
                  }}>Descargar comprobante de firma (JSON)</button>
                  <small className="muted">Verificación independiente: requiere una clave pública de confianza obtenida por separado. No acredita validez legal ni clínica.</small>
                </>}
              <input ref={filePicker} type="file" accept=".csv,text/csv" hidden
                aria-label="Seleccionar CSV descargado para verificar"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void checkSavedFile(file);
                }} />
              <button type="button" disabled={verificationPending}
                onClick={() => filePicker.current?.click()}>
                {verificationPending ? "Verificando copia…" : "Verificar CSV guardado"}
              </button>
              <small className="muted">Selecciona el historial descargado para verificar sus bytes
                en tu navegador, sin subirlo. No acredita firma digital ni validez clínica.</small>
              {savedCopyStatus && <p role="status">{savedCopyStatus}</p>}
            </>}
          </div>}
          {exportError && <p role="alert">{exportError}</p>}
    </section>
  );
}
