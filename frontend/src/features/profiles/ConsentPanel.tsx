import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePrivateAuth } from "../../app/providers/PrivateAuthProvider";
import { consentsApi, type ConsentPurpose } from "../../services/api/consents";
import { dateTime, ErrorState, InlineError } from "../../components/ui/States";
import "./consents.css";

const purposes: { id: ConsentPurpose; name: string; description: string }[] = [
  { id: "capture", name: "Captura de imágenes", description: "Registro de imágenes corporales para la finalidad indicada." },
  { id: "pose", name: "Análisis de postura", description: "Procesamiento de imágenes para estimar puntos de referencia corporal." },
  { id: "report", name: "Elaboración de reportes", description: "Preparación de informes sobre este expediente." },
  { id: "storage", name: "Conservación de imágenes", description: "Conservación limitada de imágenes vinculadas al expediente." },
];

export function ConsentPanel({ profileId }: { profileId: string }) {
  const { session } = usePrivateAuth();
  const cache = useQueryClient();
  const [purpose, setPurpose] = useState<ConsentPurpose>("capture");
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState("");
  const api = useMemo(() => session
    ? consentsApi(session.organization_id, session.token, profileId) : null,
  [session, profileId]);
  const key = ["consents", session?.organization_id, session?.user_id, profileId];
  const history = useQuery({
    queryKey: key,
    queryFn: () => api!.history(),
    enabled: Boolean(api),
    refetchInterval: 30000,
  });
  const mutation = useMutation({
    mutationFn: async (operation: { purpose: ConsentPurpose } | { id: string }) => {
      if (!api) throw new Error("Se requiere una sesión válida.");
      return "purpose" in operation ? api.accept(operation.purpose) : api.revoke(operation.id);
    },
    onSuccess: (result, operation) => {
      cache.setQueryData(key, result);
      setConfirmed(false);
      setNotice("purpose" in operation
        ? "Aceptación ficticia registrada. Vigencia de prueba: 30 días."
        : "Consentimiento revocado. El historial se conserva.");
    },
    onError: () => { void history.refetch(); },
  });
  if (!session) return null;
  const current = history.data;
  const selectedActive = current?.items.some(item => item.purpose === purpose && item.effective);
  return (
    <section className="panel consent-panel" aria-label="Consentimientos por finalidad">
      <div className="section-title">
        <div><p className="eyebrow">PRIVACIDAD DEL EXPEDIENTE</p><h2>Consentimientos</h2></div>
        <button type="button" disabled={history.isFetching || mutation.isPending}
          onClick={() => { void history.refetch(); }}>Actualizar consentimientos</button>
      </div>
      <p>Registro ficticio de aceptación por finalidad. No habilita capturas, análisis ni uso de información real.</p>
      {history.isPending && <p role="status">Consultando consentimientos…</p>}
      {history.isError && <ErrorState error={history.error} retry={() => { void history.refetch(); }} />}
      {current && !history.isError && <>
        <div className="consent-cards">
          {purposes.map(item => {
            const active = current.items.find(row => row.purpose === item.id && row.effective);
            return <article key={item.id} aria-label={item.name}>
              <h3>{item.name}</h3><p>{item.description}</p>
              <strong className={active ? "consent-active" : "consent-inactive"}>
                {active ? "Vigente" : "Sin aceptación vigente"}
              </strong>
              {active && <small>Vence: {dateTime(active.expires_at!)}</small>}
              {active && current.can_revoke && <button type="button"
                aria-label={`Revocar consentimiento de ${item.name}`}
                disabled={mutation.isPending}
                onClick={() => { setNotice(""); mutation.mutate({ id: active.id }); }}>Revocar</button>}
            </article>;
          })}
        </div>
        {current.can_record ? <form className="consent-form" onSubmit={event => {
          event.preventDefault();
          if (!confirmed || selectedActive) return;
          setNotice("");
          mutation.mutate({ purpose });
        }}>
          <label htmlFor="consent-purpose">Finalidad de la aceptación</label>
          <select id="consent-purpose" value={purpose} disabled={mutation.isPending}
            onChange={event => { setPurpose(event.target.value as ConsentPurpose); setConfirmed(false); setNotice(""); }}>
            {purposes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <p>Versión de pruebas: {current.policy_version}. Cada finalidad se registra por separado y puede revocarse conservando su historial.</p>
          <label className="consent-confirmation">
            <input type="checkbox" checked={confirmed} required disabled={mutation.isPending || selectedActive}
              onChange={event => setConfirmed(event.target.checked)} />
            Confirmo que esta aceptación corresponde únicamente al expediente ficticio y a la finalidad seleccionada.
          </label>
          <button type="submit" className="primary-button" disabled={!confirmed || selectedActive || mutation.isPending}>
            {mutation.isPending ? "Guardando…" : selectedActive ? "Aceptación ya vigente" : "Registrar aceptación ficticia"}
          </button>
        </form> : <p className="muted">{session.role === "privacy_officer"
          ? "Este rol consulta consentimientos y puede revocarlos con permiso de gestión. No registra aceptaciones."
          : "Consulta de consentimientos. Registrar aceptaciones requiere un expediente activo y permiso de edición."}</p>}
        <details><summary>Historial de aceptaciones y revocaciones</summary>
          {current.items.length === 0 ? <p>Aún no hay aceptaciones registradas.</p> :
            <ol className="consent-history">{current.items.map(item => <li key={item.id}>
              <strong>{purposes.find(p => p.id === item.purpose)?.name}</strong>
              <span>{item.effective ? "Vigente" : item.status === "revoked" ? "Revocado" : "No vigente"} · Ciclo {item.cycle} · {item.version}</span>
              {item.accepted_at && <span>Aceptación: {dateTime(item.accepted_at)}</span>}
              {item.revoked_at && <span>Revocación: {dateTime(item.revoked_at)}</span>}
              {item.expires_at && <span>Vencimiento: {dateTime(item.expires_at)}</span>}
            </li>)}</ol>}
        </details>
        <small>Estado verificado: {dateTime(current.checked_at)}.</small>
      </>}
      {mutation.isError && <InlineError error={mutation.error} />}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
