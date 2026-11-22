import { useEffect, useMemo, useRef, useState } from "react";
import type { Measurement } from "../../services/api/records";
import { DataTypeBadge } from "../../components/ui/DataTypeBadge";
import { dateTime } from "../../components/ui/States";
import { chronologicalMeasurements, compareMeasurements } from "./measurementComparison";
import { buildComparisonReport, type ComparisonReport } from "./comparisonReport";
import { saveComparisonPdf, verifiedComparisonPdf } from "./serverComparisonDownload";
import type { ComparisonDownload } from "./serverComparisonDownload";
import { verifySavedReportFile, type SavedReportReference } from "./savedReportVerification";
import { ComparisonPrintView } from "./ComparisonPrintView";

const formatSigned = (value: number) =>
  new Intl.NumberFormat("es-PE", {
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(value);

export function MeasurementComparison({
  rows,
  unit,
  profileId,
  profileCode,
  synthetic,
  metricCode,
  metricLabel,
  exportReport,
}: {
  rows: Measurement[];
  unit: string;
  profileId: string;
  profileCode: string;
  synthetic: boolean;
  metricCode: string;
  metricLabel: string;
  exportReport?: (initialId: string, finalId: string) => Promise<ComparisonDownload>;
}) {
  const ordered = useMemo(() => chronologicalMeasurements(rows), [rows]);
  const [fromId, setFromId] = useState(() => ordered[0]?.id ?? "");
  const [toId, setToId] = useState(() => ordered[ordered.length - 1]?.id ?? "");

  useEffect(() => {
    if (!ordered.some((row) => row.id === fromId))
      setFromId(ordered[0]?.id ?? "");
    if (!ordered.some((row) => row.id === toId))
      setToId(ordered[ordered.length - 1]?.id ?? "");
  }, [ordered, fromId, toId]);

  const result = compareMeasurements(ordered, fromId, toId);
  const [printReport, setPrintReport] = useState<ComparisonReport | null>(null);
  const [printError, setPrintError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [verificationPending, setVerificationPending] = useState(false);
  const [verifiedCopyStatus, setVerifiedCopyStatus] = useState("");
  const [downloadProof, setDownloadProof] = useState<SavedReportReference | null>(null);
  const savedFilePicker = useRef<HTMLInputElement>(null);
  const downloadAttempt = useRef(0);
  useEffect(() => {
    downloadAttempt.current += 1;
    setDownloading(false);
    setPrintError("");
    setDownloadProof(null);
    setVerifiedCopyStatus("");
    setVerificationPending(false);
    return () => { downloadAttempt.current += 1; };
  }, [profileId, fromId, toId]);
  const downloadReport = async () => {
    if (!exportReport || !result || !synthetic || downloading) return;
    const attempt = ++downloadAttempt.current;
    setDownloading(true);
    setPrintError("");
    try {
      const report = await exportReport(fromId, toId);
      const blob = await verifiedComparisonPdf(report);
      if (attempt === downloadAttempt.current) {
        saveComparisonPdf(blob, report.filename);
        setDownloadProof({ filename: report.filename, sha256: report.sha256, format: "pdf" });
        setVerifiedCopyStatus("");
      }
    } catch (error) {
      if (attempt === downloadAttempt.current)
        setPrintError(error instanceof Error ? error.message : "No se pudo descargar el PDF.");
    } finally {
      if (attempt === downloadAttempt.current) setDownloading(false);
    }
  };
  const checkSavedFile = async (file?: File) => {
    if (!file || !downloadProof || verificationPending) return;
    const attempt = downloadAttempt.current;
    setVerificationPending(true);
    setVerifiedCopyStatus("");
    try {
      await verifySavedReportFile(file, downloadProof);
      if (attempt === downloadAttempt.current)
        setVerifiedCopyStatus("Copia PDF verificada desde el archivo guardado en este equipo.");
    } catch (error) {
      if (attempt === downloadAttempt.current)
        setVerifiedCopyStatus(error instanceof Error ? error.message : "No se pudo verificar la copia guardada.");
    } finally {
      if (attempt === downloadAttempt.current) setVerificationPending(false);
    }
  };
  const preparePrint = () => {
    const report = buildComparisonReport(ordered, fromId, toId, {
      profileId, profileCode, synthetic, metricCode, metricLabel, unit,
    }, new Date());
    if (!report) {
      setPrintError("No se pudo preparar el informe. Revisa los registros seleccionados.");
      return;
    }
    setPrintError("");
    setPrintReport(report);
  };

  return (
    <section className="panel chart-panel" aria-labelledby="measurement-comparison-title">
      <div className="section-title">
        <h2 id="measurement-comparison-title">Comparar dos fechas</h2>
        <DataTypeBadge type="OBSERVADO" />
      </div>
      <p className="muted">
        Compara registros vigentes de la métrica seleccionada dentro del periodo.
        Esta variación es descriptiva, no una predicción clínica ni una simulación 3D.
      </p>
      {ordered.length < 2 ? (
        <p className="muted">Se necesitan al menos dos mediciones para comparar fechas.</p>
      ) : (
        <>
          <div className="record-filters">
            <label>
              Medición inicial
              <select value={fromId} onChange={(event) => setFromId(event.target.value)}>
                {ordered.map((row) => (
                  <option key={row.id} value={row.id}>
                    {dateTime(row.measured_at)} · {row.value} {unit}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Medición final
              <select value={toId} onChange={(event) => setToId(event.target.value)}>
                {ordered.map((row) => (
                  <option key={row.id} value={row.id}>
                    {dateTime(row.measured_at)} · {row.value} {unit}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!result ? (
            <p role="status" className="muted">
              Selecciona dos registros distintos, con la fecha inicial anterior a la final.
            </p>
          ) : (
            <div className="derived-grid" role="group" aria-label="Diferencia de mediciones observadas">
              <article>
                <span className="muted">Valor inicial</span>
                <p><strong>{result.from.value.toLocaleString("es-PE")} {unit}</strong></p>
              </article>
              <article>
                <span className="muted">Valor final</span>
                <p><strong>{result.to.value.toLocaleString("es-PE")} {unit}</strong></p>
              </article>
              <article>
                <span className="muted">Variación</span>
                <p><strong>{formatSigned(result.absoluteChange)} {unit}</strong></p>
                <small className="muted">
                  {result.percentChange === null
                    ? "Porcentaje no calculable con valor inicial cero."
                    : `${formatSigned(result.percentChange)} % respecto al valor inicial`}
                </small>
              </article>
            </div>
          )}
          <div className="record-report-actions">
            {exportReport ? <>
              <button type="button" disabled={!result || !synthetic || downloading}
                onClick={() => void downloadReport()}>
                {downloading ? "Generando PDF…" : "Descargar informe PDF"}
              </button>
              <small className="muted">El informe verifica las fuentes vigentes y registra la exportación.
                Solo datos ficticios; sin firma digital.</small>
              {downloadProof && <>
                <input ref={savedFilePicker} type="file" accept=".pdf,application/pdf" hidden
                  aria-label="Seleccionar PDF descargado para verificar"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void checkSavedFile(file);
                  }} />
                <button type="button" disabled={verificationPending}
                  onClick={() => savedFilePicker.current?.click()}>
                  {verificationPending ? "Verificando copia…" : "Verificar PDF guardado"}
                </button>
                <small className="muted">Selecciona el archivo descargado: se leerá solo en tu navegador
                  para contrastarlo con la huella del servidor. No acredita firma digital.</small>
                {verifiedCopyStatus && <p role="status">{verifiedCopyStatus}</p>}
              </>}
            </> : <>
              <button type="button" disabled={!result || !synthetic}
                onClick={preparePrint}>Preparar informe PDF</button>
              <small className="muted">Exportación local para expedientes ficticios; el navegador permite guardar como PDF.
                No se exportan simulaciones ni registros sustituidos.</small>
            </>}
          </div>
          {printError && <p role="alert">{printError}</p>}
          {printReport && <ComparisonPrintView report={printReport}
            onClose={() => setPrintReport(null)}/>}
        </>
      )}
    </section>
  );
}
