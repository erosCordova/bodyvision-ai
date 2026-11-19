import { useMemo, useState } from "react";
import { accountSecurityApi, type AuditIntegrity } from "../../services/api/accountSecurity";

export function AuditIntegrityPanel({ token, onVerified }: { token: string; onVerified: () => void }) {
  const api = useMemo(() => accountSecurityApi(token), [token]);
  const [result, setResult] = useState<AuditIntegrity | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function verify() {
    setBusy(true); setError(""); setResult(null);
    try { setResult(await api.verifyAudit()); onVerified(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo verificar la auditoría."); }
    finally { setBusy(false); }
  }
  return <section className="private-admin-integrity" aria-label="Integridad de auditoría">
    <h3>Integridad del registro</h3>
    <p>Comprueba la cadena completa de tu organización, aunque la tabla muestre solo los últimos 30 eventos.</p>
    <button type="button" disabled={busy} onClick={() => void verify()}>
      {busy ? "Verificando cadena…" : "Verificar integridad de auditoría"}
    </button>
    {error && <p role="alert" className="private-admin-error">{error}</p>}
    {result && <div className={result.valid ? "private-admin-success" : "private-admin-error"}
      role={result.valid ? "status" : "alert"}>
      <strong>{result.valid ? "Cadena íntegra en el punto verificado" : "Se detectó una inconsistencia en la auditoría"}</strong>
      <p>{result.checked_events} eventos revisados · {new Date(result.checked_at).toLocaleString("es-PE")}</p>
      {result.first_invalid_sequence !== null && <p>Primera posición inconsistente: {result.first_invalid_sequence}.</p>}
      <details><summary>Punto de comprobación</summary><p>Secuencia: {result.checkpoint_sequence}</p><code>{result.checkpoint_hash}</code></details>
    </div>}
    <small>La comprobación corresponde al momento indicado. No sustituye un respaldo ni una certificación externa.</small>
  </section>;
}
