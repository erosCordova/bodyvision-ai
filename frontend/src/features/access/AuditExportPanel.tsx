import { useEffect, useRef, useState } from "react";
import { downloadAudit } from "../../services/api/auditExport";
import { MAX_AUDIT_BYTES, verifyAuditBytes, compareAuditContinuity } from "./auditBundle";

type Receipt = { filename: string; sha256: string; sequence: number; checkpointHash: string };

export function AuditExportPanel({ token, organizationId, identityKey }: {
  token: string; organizationId: string; identityKey: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [olderFile, setOlderFile] = useState<File | null>(null);
  const [newerFile, setNewerFile] = useState<File | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    setBusy(false); setError(""); setNotice(""); setReceipt(null);
    setOlderFile(null); setNewerFile(null);
    return () => { generation.current += 1; controller.current?.abort(); };
  // A JWT rotation belongs to the same identity and must not cancel its retry.
  }, [identityKey, organizationId]);

  async function exportFile() {
    const epoch = ++generation.current;
    controller.current?.abort();
    const active = new AbortController(); controller.current = active;
    setBusy(true); setError(""); setNotice(""); setReceipt(null);
    try {
      const result = await downloadAudit(token, organizationId, active.signal);
      if (active.signal.aborted || generation.current !== epoch) return;
      const url = URL.createObjectURL(result.blob);
      try {
        const link = document.createElement("a"); link.href = url; link.download = result.filename; link.click();
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
      setReceipt({ filename: result.filename, sha256: result.summary.sha256,
        sequence: result.summary.sequence, checkpointHash: result.summary.hash });
      setNotice(`${result.summary.sequence} eventos comprobados. Archivo enviado a las descargas del navegador.`);
    } catch (cause) {
      if (!active.signal.aborted && generation.current === epoch)
        setError(cause instanceof Error ? cause.message : "No se pudo exportar la auditoría.");
    } finally { if (generation.current === epoch) setBusy(false); }
  }

  async function verifyFile(file: File) {
    const epoch = ++generation.current;
    setBusy(true); setError(""); setNotice("");
    try {
      if (file.size < 1 || file.size > MAX_AUDIT_BYTES) throw new Error("El archivo está vacío o supera 8 MiB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length !== file.size) throw new Error("La lectura del archivo está incompleta.");
      const summary = await verifyAuditBytes(bytes);
      if (generation.current !== epoch) return;
      const matches = receipt?.filename === file.name;
      if (matches && receipt.sha256 !== summary.sha256)
        throw new Error("El archivo guardado cambió respecto de la descarga comprobada.");
      setNotice(`${summary.sequence} eventos con coherencia interna verificada.${matches ? " Coincide con la descarga reciente." : ""}`);
    } catch (cause) {
      if (generation.current === epoch)
        setError(cause instanceof Error ? cause.message : "No se pudo comprobar el archivo.");
    } finally { if (generation.current === epoch) setBusy(false); }
  }

  async function compareFiles() {
    if (!olderFile || !newerFile || busy) return;
    const epoch = ++generation.current;
    setBusy(true); setError(""); setNotice("");
    try {
      const read = async (file: File) => {
        if (file.size < 1 || file.size > MAX_AUDIT_BYTES)
          throw new Error("El archivo está vacío o supera 8 MiB.");
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.length !== file.size) throw new Error("La lectura del archivo está incompleta.");
        return bytes;
      };
      const older = await read(olderFile);
      const newer = await read(newerFile);
      const result = await compareAuditContinuity(older, newer, organizationId);
      if (generation.current === epoch)
        setNotice(`Continuidad comprobada: ${result.previous} eventos anteriores conservados y ${result.added} eventos adicionales.`);
    } catch (cause) {
      if (generation.current === epoch)
        setError(cause instanceof Error ? cause.message : "No se pudo comprobar la continuidad.");
    } finally { if (generation.current === epoch) setBusy(false); }
  }

  return <section className="private-admin-integrity" aria-label="Exportación de auditoría">
    <h3>Auditoría verificable</h3>
    <p>Exporta el registro de tu organización: hasta 10.000 eventos y 8 MiB. Un exceso bloquea el archivo completo.</p>
    <button type="button" disabled={busy} onClick={() => { void exportFile(); }}>
      {busy ? "Comprobando archivo…" : "Descargar auditoría verificable"}
    </button>
    <label>Verificar un archivo de auditoría
      <input type="file" accept="application/json,.json" disabled={busy} onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
        if (file) void verifyFile(file);
      }} />
    </label>
    <details>
      <summary>Comparar con una auditoría anterior</summary>
      <p>Usa una copia anterior conservada independientemente y una auditoría actual de esta organización.
        Se verifican ambas cadenas y que la actual conserve el punto de control anterior.</p>
      <label>Auditoría anterior de confianza
        <input type="file" accept="application/json,.json" disabled={busy} onChange={event => {
          setOlderFile(event.currentTarget.files?.[0] ?? null);
          setNotice(""); setError("");
        }} />
      </label>
      <label>Auditoría actual
        <input type="file" accept="application/json,.json" disabled={busy} onChange={event => {
          setNewerFile(event.currentTarget.files?.[0] ?? null);
          setNotice(""); setError("");
        }} />
      </label>
      <button type="button" disabled={busy || !olderFile || !newerFile} onClick={() => void compareFiles()}>
        Comprobar continuidad de auditoría
      </button>
      <small>La referencia debe ser confiable. No acredita custodia, fecha certificada ni autoría independiente.</small>
    </details>
    {error && <p role="alert" className="private-admin-error">{error}</p>}
    {notice && <p role="status" className="private-admin-success">{notice}</p>}
    {receipt && <details><summary>Referencia del archivo descargado</summary>
      <p>Eventos: {receipt.sequence}. Hash final: <code>{receipt.checkpointHash}</code></p>
      <p>SHA-256 del archivo: <code>{receipt.sha256}</code></p>
    </details>}
    <small>La verificación del archivo ocurre en este navegador. La coherencia de hashes no certifica autoría ni sustituye un punto de referencia externo.</small>
  </section>;
}
