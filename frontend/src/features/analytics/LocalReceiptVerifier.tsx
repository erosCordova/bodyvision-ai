import { useEffect, useRef, useState } from "react";
import { verifyLocalReportReceipt } from "./verifyReportReceipt";

export function LocalReceiptVerifier() {
  const [report, setReport] = useState<File | null>(null);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [key, setKey] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);
  const reset = () => {
    generation.current += 1;
    setBusy(false);
    setStatus("");
  };
  const verify = async () => {
    if (!report || !receipt || !key || busy) return;
    const attempt = ++generation.current;
    setBusy(true);
    setStatus("");
    try {
      await verifyLocalReportReceipt(report, receipt, key);
      if (generation.current === attempt)
        setStatus("Firma Ed25519 verificada con la clave pública seleccionada. Los bytes coinciden.");
    } catch (error) {
      if (generation.current === attempt)
        setStatus(error instanceof Error ? error.message : "No se pudo verificar la firma.");
    } finally {
      if (generation.current === attempt) setBusy(false);
    }
  };
  return (
    <details className="record-report-actions">
      <summary>Verificar firma de un informe guardado</summary>
      <p className="muted">Selecciona un PDF o CSV ficticio, su comprobante JSON y una clave pública
        Ed25519 de 32 bytes obtenida por un canal independiente de confianza.
        Los archivos se leen aquí, sin enviarlos al servidor. No es una certificación legal ni clínica.</p>
      <label>Informe guardado (PDF o CSV)
        <input type="file" accept=".pdf,.csv" onChange={event => {
          reset(); setReport(event.currentTarget.files?.[0] ?? null);
        }}/>
      </label>
      <label>Comprobante de firma (JSON)
        <input type="file" accept=".json,application/json" onChange={event => {
          reset(); setReceipt(event.currentTarget.files?.[0] ?? null);
        }}/>
      </label>
      <label>Clave pública de confianza (32 bytes)
        <input type="file" onChange={event => {
          reset(); setKey(event.currentTarget.files?.[0] ?? null);
        }}/>
      </label>
      <button type="button" disabled={busy || !report || !receipt || !key}
        onClick={() => void verify()}>
        {busy ? "Verificando firma…" : "Verificar firma Ed25519"}
      </button>
      {status && <p role="status">{status}</p>}
    </details>
  );
}
