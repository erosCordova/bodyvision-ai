import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { privateAuthEnabled, usePrivateAuth } from "../../app/providers/PrivateAuthProvider";
import { useWorkspace } from "../../app/providers/WorkspaceProvider";
import {
  kindLabels, privacyRequestsApi, type PrivacyKind, type PrivacyRequest,
} from "../../services/api/privacyRequests";
import { ConsentPanel } from "../profiles/ConsentPanel";

const dateLabel = (value: string) => new Date(value).toLocaleString("es-PE", {
  timeZone: "America/Lima",
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

export function PrivacyRequestsPage() {
  const { session } = usePrivateAuth();
  const { id: workspaceId, api: records } = useWorkspace();
  const [profileId, setProfileId] = useState("");
  const [profileSearch, setProfileSearch] = useState("");
  const [profileListOffset, setProfileListOffset] = useState(0);
  const [kind, setKind] = useState<PrivacyKind>("access");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [profileOffset, setProfileOffset] = useState(0);
  const [queueOffset, setQueueOffset] = useState(0);
  const [queueStatus, setQueueStatus] = useState<"all" | "received" | "in_review">("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [consentProfile, setConsentProfile] = useState("");
  const privacyOnly = session?.role === "privacy_officer";
  const canReview = session?.role === "administrator" || privacyOnly;
  const privateClient = useMemo(
    () => session ? privacyRequestsApi(workspaceId, session.token) : null,
    [workspaceId, session],
  );
  const profiles = useQuery({
    queryKey: [
      "privacy-profiles", session?.organization_id, session?.user_id,
      profileSearch, profileListOffset,
    ],
    queryFn: () => records.profiles(profileSearch, profileListOffset),
    enabled: Boolean(session && !privacyOnly),
  });
  useEffect(() => {
    if (!profiles.data) return;
    const options = profiles.data.items;
    if (!options.some(item => item.id === profileId)) {
      setProfileId(options[0]?.id ?? "");
    }
  }, [profileId, profiles.data]);
  const history = useQuery({
    queryKey: ["privacy-history", session?.user_id, profileId, profileOffset],
    queryFn: () => privateClient!.listProfile(profileId, profileOffset),
    enabled: Boolean(privateClient && profileId && !privacyOnly),
  });
  const queue = useQuery({
    queryKey: [
      "privacy-queue", session?.organization_id, session?.user_id, session?.role,
      queueOffset, queueStatus, overdueOnly,
    ],
    queryFn: () => privateClient!.listQueue(queueOffset, queueStatus, overdueOnly),
    enabled: Boolean(privateClient && canReview),
  });

  if (!privateAuthEnabled() || !session) {
    return <main className="enterprise-module">
      <h1>Solicitudes de privacidad</h1>
      <p>Disponible únicamente en el entorno local de pruebas con sesión privada.</p>
    </main>;
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!privateClient || !profileId || pending) return;
    setPending(true); setError(""); setNotice("");
    try {
      await privateClient.submit(profileId, kind);
      setProfileOffset(0);
      await history.refetch();
      if (session.role === "administrator") await queue.refetch();
      setNotice("Solicitud ficticia registrada para revisión. No implica ejercicio de derechos reales.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo registrar la solicitud.");
    } finally {
      setPending(false);
    }
  };

  const review = async (item: PrivacyRequest) => {
    if (!privateClient || pending) return;
    setPending(true); setError(""); setNotice("");
    try {
      await privateClient.startReview(item.id);
      await Promise.all([queue.refetch(), history.refetch()]);
      setNotice("Revisión administrativa ficticia iniciada. La solicitud no está resuelta.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo iniciar la revisión.");
    } finally {
      setPending(false);
    }
  };

  const rows = (items: PrivacyRequest[], canReview: boolean) => (
    <ul>
      {items.map(item => <li key={item.id}>
        <strong>{item.profile_code} · {kindLabels[item.request_type]}</strong>
        {" · "}{item.status === "received" ? "Recibida" : "En revisión"}
        <p>Recibida: {dateLabel(item.received_at)}. Objetivo interno de atención (hora de Lima): {dateLabel(item.review_target_at)}.</p>
        {item.review_overdue && <p role="status">Atención interna atrasada (no es un plazo legal).</p>}
        {canReview && item.status === "received" && <button type="button"
          disabled={pending || !item.can_review} onClick={() => { void review(item); }}>Iniciar revisión</button>}
        {canReview && !item.can_review && <p>Permiso de consulta: iniciar revisión requiere gestión.</p>}
        {privacyOnly && <button type="button" onClick={() => setConsentProfile(item.profile_id)}>
          Consultar consentimientos de {item.profile_code}
        </button>}
      </li>)}
    </ul>
  );

  return <div className="enterprise-module" aria-label="Solicitudes de privacidad ficticias">
    <h1>Solicitudes de privacidad</h1>
    <p>Solo datos ficticios. Este módulo registra solicitudes y permite iniciar una
      revisión interna: no valida identidad legal, no exporta ni elimina información,
      y no resuelve solicitudes reales.</p>
    {privacyOnly && <p>Responsable de privacidad: solo solicitudes y consentimientos de expedientes autorizados.
      No puedes aceptar consentimientos en nombre del titular ni abrir los datos corporales.</p>}
    {!privacyOnly && <section className="enterprise-panel">
      <h2>Registrar solicitud ficticia</h2>
      {profiles.isLoading && <p role="status">Consultando expedientes autorizados…</p>}
      {profiles.isError && <p role="alert">No se pudieron cargar los expedientes.</p>}
      <label htmlFor="privacy-profile-search">Buscar expediente por código o referencia</label>
      <input id="privacy-profile-search" type="search" value={profileSearch}
        onChange={event => {
          setProfileSearch(event.target.value);
          setProfileListOffset(0);
          setProfileId("");
          setProfileOffset(0);
        }}
        placeholder="Código o referencia ficticia" />
      {profiles.data && <div className="pagination">
        <span>{profiles.data.total} expedientes disponibles</span>
        <button type="button" disabled={profileListOffset === 0}
          onClick={() => {
            setProfileListOffset(Math.max(0, profileListOffset - 12));
            setProfileId("");
            setProfileOffset(0);
          }}>Anterior expediente</button>
        <button type="button" disabled={profileListOffset + 12 >= profiles.data.total}
          onClick={() => {
            setProfileListOffset(profileListOffset + 12);
            setProfileId("");
            setProfileOffset(0);
          }}>Siguiente expediente</button>
      </div>}
      <form onSubmit={event => { void submit(event); }}>
        <label htmlFor="privacy-profile">Expediente autorizado</label>
        <select id="privacy-profile" value={profileId}
          onChange={event => { setProfileId(event.target.value); setProfileOffset(0); }}
          disabled={!profiles.data?.items.length || pending}>
          {!profileId && <option value="">Selecciona un expediente autorizado</option>}
          {(profiles.data?.items ?? []).map(item =>
            <option key={item.id} value={item.id}>{item.display_code}</option>)}
        </select>
        <label htmlFor="privacy-kind">Tipo de solicitud</label>
        <select id="privacy-kind" value={kind} disabled={pending}
          onChange={event => setKind(event.target.value as PrivacyKind)}>
          {(Object.keys(kindLabels) as PrivacyKind[]).map(key =>
            <option key={key} value={key}>{kindLabels[key]}</option>)}
        </select>
        <button type="submit" disabled={!profileId || pending}>
          {pending ? "Registrando…" : "Registrar solicitud ficticia"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>}
    {!privacyOnly && <section className="enterprise-panel">
      <h2>Mis solicitudes del expediente</h2>
      <p>Este historial solo muestra las solicitudes que registraste con tu propia sesión.</p>
      {history.isLoading && <p role="status">Consultando solicitudes…</p>}
      {history.isError && <p role="alert">No se pudo cargar el historial.
        <button type="button" onClick={() => { void history.refetch(); }}>Reintentar</button></p>}
      {history.data && <>
        <p>{history.data.total} solicitudes registradas.</p>
        {rows(history.data.items, false)}
        <button type="button" disabled={profileOffset === 0}
          onClick={() => setProfileOffset(Math.max(0, profileOffset - 20))}>Anterior</button>
        <button type="button" disabled={profileOffset + 20 >= history.data.total}
          onClick={() => setProfileOffset(profileOffset + 20)}>Siguiente</button>
      </>}
    </section>}
    {canReview && <section className="enterprise-panel">
      <h2>Cola de revisión administrativa</h2>
      <p>Solo aparecen expedientes con permiso explícito. Iniciar revisión no significa atender ni cerrar la solicitud;
        conserva el objetivo original y cualquier aviso de atraso.</p>
      <label htmlFor="privacy-queue-status">Filtrar solicitudes por estado</label>
      <select id="privacy-queue-status" value={queueStatus}
        onChange={event => {
          setQueueStatus(event.target.value as "all" | "received" | "in_review");
          setQueueOffset(0);
        }}>
        <option value="all">Todos los estados</option>
        <option value="received">Recibidas</option>
        <option value="in_review">En revisión</option>
      </select>
      <label htmlFor="privacy-queue-overdue">
        <input id="privacy-queue-overdue" type="checkbox" checked={overdueOnly}
          onChange={event => { setOverdueOnly(event.target.checked); setQueueOffset(0); }} />
        Solo solicitudes con atención interna atrasada
      </label>
      {queue.isLoading && <p role="status">Consultando cola…</p>}
      {queue.isError && <p role="alert">No se pudo consultar la cola.
        <button type="button" onClick={() => { void queue.refetch(); }}>Reintentar</button></p>}
      {queue.data && <>
        <p>{queue.data.total} solicitudes accesibles.</p>
        {rows(queue.data.items, true)}
        <button type="button" disabled={queueOffset === 0}
          onClick={() => setQueueOffset(Math.max(0, queueOffset - 20))}>Anterior</button>
        <button type="button" disabled={queueOffset + 20 >= queue.data.total}
          onClick={() => setQueueOffset(queueOffset + 20)}>Siguiente</button>
      </>}
    </section>}
    {privacyOnly && consentProfile && <section className="enterprise-panel" key={consentProfile}>
      <button type="button" onClick={() => setConsentProfile("")}>Cerrar consentimientos</button>
      <ConsentPanel profileId={consentProfile} />
    </section>}
  </div>;
}
