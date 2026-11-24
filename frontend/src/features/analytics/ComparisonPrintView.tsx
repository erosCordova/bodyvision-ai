import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { ComparisonReport } from "./comparisonReport";
import "./comparison-print.css";

const timeLima = (iso: string) => new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  dateStyle: "medium",
  timeStyle: "short",
}).format(new Date(iso));

const format = (n: number) => new Intl.NumberFormat("es-PE", {
  maximumFractionDigits: 2,
}).format(n);

export function ComparisonPrintView({
  report, onClose,
}: {
  report: ComparisonReport;
  onClose: () => void;
}) {
  const host = useRef<HTMLElement | null>(null);
  const printed = useRef(false);
  if (!host.current) {
    host.current = document.createElement("section");
    host.current.className = "bodyvision-comparison-print";
    host.current.setAttribute("aria-label", "Informe imprimible de comparación");
  }
  useEffect(() => {
    const target = host.current!;
    document.body.appendChild(target);
    const onAfterPrint = () => onClose();
    window.addEventListener("afterprint", onAfterPrint);
    // Allow the portal to render and the browser to calculate print layout.
    const id = window.requestAnimationFrame(() => {
      if (printed.current) return;
      printed.current = true;
      window.print();
    });
    return () => {
      window.cancelAnimationFrame(id);
      window.removeEventListener("afterprint", onAfterPrint);
      target.remove();
    };
  }, [onClose]);

  const percent = report.percentChange === null
    ? "No calculable (valor inicial cero)"
    : `${format(report.percentChange)} %`;

  return createPortal(
    <div className="bodyvision-print-sheet">
      <header>
        <p className="bodyvision-print-brand">BODYVISION AI · INFORME DESCRIPTIVO</p>
        <h1>Comparación de mediciones</h1>
        <p className="bodyvision-print-synthetic">DATOS FICTICIOS · NO APTO PARA USO CLÍNICO</p>
      </header>
      <dl className="bodyvision-print-meta">
        <div><dt>Expediente</dt><dd>{report.profileCode}</dd></div>
        <div><dt>Métrica</dt><dd>{report.metricLabel} ({report.unit})</dd></div>
        <div><dt>Preparado</dt><dd>{timeLima(report.generatedAt)} · Lima (UTC−05)</dd></div>
        <div><dt>Procedencia</dt><dd>OBSERVADO · Mediciones vigentes</dd></div>
      </dl>
      <h2>Registros comparados</h2>
      <table>
        <thead><tr><th>Registro</th><th>Fecha (Lima)</th><th>Valor</th></tr></thead>
        <tbody>
          <tr><th scope="row">Inicial</th><td>{timeLima(report.from.measuredAt)}</td>
            <td>{format(report.from.value)} {report.unit}</td></tr>
          <tr><th scope="row">Final</th><td>{timeLima(report.to.measuredAt)}</td>
            <td>{format(report.to.value)} {report.unit}</td></tr>
        </tbody>
      </table>
      <div className="bodyvision-print-difference">
        <p><strong>Variación absoluta</strong><span>{format(report.absoluteChange)} {report.unit}</span></p>
        <p><strong>Variación relativa</strong><span>{percent}</span></p>
      </div>
      <h2>Trazabilidad de las fuentes</h2>
      <dl className="bodyvision-print-sources">
        <div><dt>ID de la medición inicial</dt><dd>{report.from.id}</dd></div>
        <div><dt>ID de la medición final</dt><dd>{report.to.id}</dd></div>
      </dl>
      <footer>
        <p>Los valores corresponden exclusivamente a dos registros observados vigentes
          del mismo expediente ficticio y de la misma métrica, obtenidos desde
          una respuesta autorizada de la API. No incluyen simulaciones 3D,
          correcciones sustituidas ni inferencias clínicas.</p>
        <p>Documento generado localmente mediante la opción de impresión del navegador.
          No tiene firma digital, sello de servidor ni certificación médica.
          Seleccione «Guardar como PDF» en el diálogo de impresión. Conserve el
          archivo únicamente en un entorno de pruebas autorizado.</p>
      </footer>
    </div>,
    host.current,
  );
}
