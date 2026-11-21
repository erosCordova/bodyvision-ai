import { useEffect, useRef, useState } from "react";
import { readOperations, type OperationsStatus } from "../../services/api/operations";

const alerts: Record<OperationsStatus["alerts"][number], string> = {
  server_failures: "Se han detectado fallos recientes del servicio.",
  query_interrupted: "Una consulta se interrumpió o agotó el tiempo de espera permitido.",
  slow_responses: "Se han detectado tiempos de respuesta elevados.",
  database_unavailable: "No se pudo verificar la conexión y versión de la base de datos.",
  retention_failed: "La última limpieza automática no se completó.",
  retention_overdue: "La limpieza automática no informa actividad dentro del intervalo esperado.",
};
const retentionNames: Record<OperationsStatus["retention"]["state"], string> = {
  ready: "Última ejecución completada", failed: "Última ejecución fallida",
  pending: "Esperando la primera ejecución", overdue: "Comprobación retrasada",
  disabled: "Desactivada en este proceso",
};
const limaTime = (value: string) => new Date(value).toLocaleString("es-PE", {
  timeZone: "America/Lima",
});

export function OperationsPanel({ token }: { token: string }) {
  const [result, setResult] = useState<OperationsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    setResult(null); setError(""); setBusy(false);
    return () => { const previous = request.current; request.current = null; previous?.abort(); };
  }, [token]);
  async function refresh() {
    if (busy) return;
    const controller = new AbortController();
    request.current?.abort(); request.current = controller;
    setBusy(true); setError(""); setResult(null);
    const timer = window.setTimeout(() => controller.abort(), 7000);
    try {
      const value = await readOperations(token, controller.signal);
      if (!controller.signal.aborted) setResult(value);
    } catch (cause) {
      if (request.current === controller && !controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "No se pudo consultar el servicio.");
      else if (request.current === controller && controller.signal.aborted)
        setError("La consulta no se completó. Puedes volver a intentarlo.");
    } finally {
      window.clearTimeout(timer);
      if (request.current === controller) setBusy(false);
    }
  }
  return <section className="enterprise-panel operations-panel" aria-label="Estado del servicio">
    <div className="private-admin-audit-head">
      <div><h2>Estado del servicio</h2>
        <p>Consulta respuestas recientes de tu organización y la disponibilidad actual del servicio.</p></div>
      <button type="button" disabled={busy} onClick={() => void refresh()}>
        {busy ? "Consultando…" : "Consultar estado del servicio"}
      </button>
    </div>
    {error && <p role="alert" className="private-admin-error">{error}</p>}
    {result && <>
      <p role="status" className={result.alerts.length ? "private-admin-error" : "private-admin-success"}>
        <strong>{result.alerts.length ? "Requiere atención" : result.sample_count ? "Sin avisos activos" : "Sin muestras recientes"}</strong>
        {" · Consulta: "}{limaTime(result.checked_at)} (Lima)
      </p>
      {result.alerts.length > 0 && <ul aria-label="Avisos del servicio">
        {result.alerts.map(code => <li key={code}>{alerts[code]}</li>)}
      </ul>}
      <dl className="operations-grid">
        <div><dt>Respuestas de la muestra</dt><dd>{result.sample_count}</dd></div>
        <div><dt>Solicitudes completadas</dt><dd>{result.successes}</dd></div>
        <div><dt>Solicitudes rechazadas</dt><dd>{result.client_errors}</dd></div>
        <div><dt>Fallos del servicio</dt><dd>{result.server_errors}</dd></div>
        <div><dt>Consultas interrumpidas</dt><dd>{result.query_interruptions}</dd></div>
        <div><dt>Tiempo de respuesta P95</dt><dd>{result.p95_ms === null ? "Sin muestras" : `${result.p95_ms.toLocaleString("es-PE")} ms`}</dd></div>
        <div><dt>Base de datos</dt><dd>{result.database.state === "ready" ? "Disponible y con esquema vigente" : "No disponible o esquema incompatible"}</dd></div>
        <div><dt>Limpieza automática en este proceso</dt><dd>{retentionNames[result.retention.state]}</dd></div>
      </dl>
      {result.retention.checked_at && <p>Última limpieza comprobada: {limaTime(result.retention.checked_at)} (Lima).</p>}
      <p>Hasta {result.sample_limit} respuestas autenticadas de los últimos {result.window_seconds / 60} minutos.
        La consulta de este panel no se cuenta en la muestra. Los datos se reinician con el proceso.</p>
      <details><summary>Cómo interpretar los avisos</summary>
        <p>P95 usa el rango más próximo: con pocas muestras puede coincidir con el mayor tiempo.
          Se avisa desde 3 fallos, o desde 5 respuestas con al menos un 20 % de fallos;
          desde 5 respuestas con P95 de 2 segundos; y ante cualquier consulta interrumpida o con espera agotada.
          El tiempo corresponde al procesamiento del servidor, sin incluir la descarga completa.</p>
        <p>La limpieza se considera retrasada tras dos intervalos sin resultado.
          Estos avisos se consultan aquí y no se envían a servicios externos.</p>
      </details>
    </>}
  </section>;
}
