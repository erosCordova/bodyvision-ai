import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { usePrivateAuth } from "../../app/providers/PrivateAuthProvider";
import { useWorkspace } from "../../app/providers/WorkspaceProvider";
import { consentsApi } from "../../services/api/consents";
import { poseSummariesApi, type PoseSummaryDraft } from "../../services/api/poseSummaries";
import { dateTime } from "../../components/ui/States";

const stateNames = { "not-detected": "Sin detección", insufficient: "Visibilidad insuficiente",
  caution: "Requiere revisión", reviewable: "Revisable de forma experimental" };

export function PoseSummaryArchive({ summary, runSerial }: {
  summary: PoseSummaryDraft | null; runSerial: number;
}) {
  const { session } = usePrivateAuth();
  const { api } = useWorkspace();
  const [search, setSearch] = useState("");
  const [profileId, setProfileId] = useState("");
  const [offset, setOffset] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const requestKey = useRef(crypto.randomUUID());
  const summaryStamp = JSON.stringify(summary);
  const scope = session ? [session.organization_id, session.user_id] : [];
  const profiles = useQuery({ queryKey: ["pose-summary-profiles", ...scope, search],
    queryFn: () => api.profiles(search), enabled: Boolean(session) });
  const consents = useQuery({ queryKey: ["pose-summary-consents", ...scope, profileId],
    queryFn: () => consentsApi(session!.organization_id, session!.token, profileId).history(),
    enabled: Boolean(session && profileId) });
  const consentOk = ["pose", "storage"].every(purpose =>
    consents.data?.items.some(item => item.purpose === purpose && item.effective));
  const history = useQuery({ queryKey: ["pose-summary-history", ...scope, profileId, offset],
    queryFn: ({ signal }) => poseSummariesApi(session!.token, profileId).list(offset, signal),
    enabled: Boolean(session && profileId && consentOk) });
  useEffect(() => {
    sequence.current += 1; requestKey.current = crypto.randomUUID();
    setConfirmed(false); setBusy(false); setError(""); setNotice("");
    return () => { sequence.current += 1; };
  }, [profileId, session?.token, summaryStamp, runSerial]);
  useEffect(() => { setOffset(0); }, [profileId]);
  const canWrite = session?.role === "administrator" || session?.role === "specialist";

  async function save() {
    if (!session || !profileId || !summary || !confirmed || !consentOk || busy || !canWrite) return;
    const generation = sequence.current;
    setBusy(true); setError(""); setNotice("");
    try {
      await poseSummariesApi(session.token, profileId).save(summary, requestKey.current);
      if (generation !== sequence.current) return;
      setConfirmed(false); setOffset(0);
      setNotice("Resumen de pose guardado y auditado. La fotografía y las coordenadas no se han enviado.");
      if (!offset) await history.refetch();
    } catch (cause) {
      if (generation === sequence.current) setError(cause instanceof Error ? cause.message : "No se pudo guardar.");
    } finally { if (generation === sequence.current) setBusy(false); }
  }
  async function erase(id: string) {
    if (!session || busy || !canWrite || !window.confirm("¿Eliminar este resumen ficticio? La acción quedará auditada.")) return;
    const generation = sequence.current;
    setBusy(true); setError(""); setNotice("");
    try {
      await poseSummariesApi(session.token, profileId).remove(id);
      if (generation !== sequence.current) return;
      setNotice("Resumen eliminado. El mismo envío no puede volver a crearlo.");
      if (offset) setOffset(0);
      else await history.refetch();
    } catch (cause) {
      if (generation === sequence.current) setError(cause instanceof Error ? cause.message : "No se pudo eliminar.");
    } finally { if (generation === sequence.current) setBusy(false); }
  }
  if (!session) return null;
  return <section className="enterprise-pose-benchmark" aria-label="Historial privado de resultados de pose">
    <h4>Historial de resultados de pose</h4>
    <p>Resúmenes ficticios asociados al expediente: recuentos, umbral y versión del modelo.
      No contienen fotografías ni coordenadas. El servidor conserva el resultado comunicado
      por este navegador; no verifica por sí mismo la inferencia ni su precisión.</p>
    <label>Buscar expediente para resultados de pose
      <input type="search" value={search} disabled={busy} onChange={event => {
        setSearch(event.target.value); setProfileId("");
      }}/>
    </label>
    <label>Expediente para resultados de pose
      <select value={profileId} disabled={busy} onChange={event => setProfileId(event.target.value)}>
        <option value="">Seleccionar expediente ficticio</option>
        {profiles.data?.items.map(profile => <option key={profile.id} value={profile.id}>{profile.display_code}</option>)}
      </select>
    </label>
    {profiles.isError && <p role="alert">No se pudo consultar los expedientes.</p>}
    {profileId && <>
      <Link to={`/profiles/${profileId}`}>Gestionar aceptaciones del expediente</Link>
      <button type="button" disabled={busy || consents.isFetching} onClick={() => void consents.refetch()}>Actualizar aceptaciones de pose</button>
      {consents.isError && <p role="alert">No se pudieron verificar las aceptaciones.</p>}
      {!consentOk && <p>Registra aceptaciones vigentes de pose y conservación para consultar o guardar resúmenes.</p>}
    </>}
    {profileId && consentOk && <>
      {canWrite && <>
        <label><input type="checkbox" checked={confirmed} disabled={busy || !summary}
          onChange={event => setConfirmed(event.target.checked)}/>
          Confirmo que el resultado procede exclusivamente de una imagen ficticia.
        </label>
        <button type="button" disabled={busy || !summary || !confirmed}
          onClick={() => void save()}>{busy ? "Procesando resumen…" : "Guardar resultado de pose"}</button>
        {!summary && <p>Ejecuta la detección local para guardar su resumen.</p>}
      </>}
      <button type="button" disabled={busy || history.isFetching} onClick={() => void history.refetch()}>Actualizar historial de pose</button>
      {history.isFetching && <p role="status">Consultando resultados guardados…</p>}
      {history.isError && <p role="alert">{history.error.message}</p>}
      {history.data && !history.isError && <>
        <p role="status" aria-label="Página de resultados de pose">{history.data.total} resúmenes guardados · página {Math.floor(offset / 20) + 1}</p>
        <ol>{history.data.items.map(row => <li key={row.id}>
          <strong>{stateNames[row.quality_state]}</strong> · {dateTime(row.created_at)} · DERIVADO FICTICIO
          <p>{row.visible_points}/33 puntos visibles · {row.core_visible}/8 principales · umbral {row.threshold}.</p>
          <small>{row.model_revision} · {row.algorithm_revision}. Origen: navegador; no verificado clínicamente.</small>
          {canWrite && <button type="button" disabled={busy} onClick={() => void erase(row.id)}>Eliminar resumen de pose</button>}
        </li>)}</ol>
        <button type="button" disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Página anterior de resultados de pose</button>
        <button type="button" disabled={busy || offset + 20 >= history.data.total} onClick={() => setOffset(offset + 20)}>Página siguiente de resultados de pose</button>
      </>}
    </>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <small>Revocar pose o conservación elimina los resúmenes de este expediente en la base activa.
      Los registros de auditoría y las claves de envío se conservan; el borrado de copias de seguridad requiere su política independiente.</small>
  </section>;
}
