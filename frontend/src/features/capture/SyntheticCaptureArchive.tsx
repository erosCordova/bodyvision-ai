import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { usePrivateAuth } from "../../app/providers/PrivateAuthProvider";
import { useWorkspace } from "../../app/providers/WorkspaceProvider";
import { dateTime } from "../../components/ui/States";
import { consentsApi } from "../../services/api/consents";
import {
  CAPTURE_ARCHIVE_PAGE_SIZE, prepareSyntheticPng, syntheticCapturesApi,
} from "../../services/api/syntheticCaptures";
import type { CaptureReview } from "./captureQuality";
import { ServerPosePanel } from "./ServerPosePanel";

/** Optional encrypted repository of fictional samples. No clinical photos. */
export function SyntheticCaptureArchive({
  file, review,
}: { file: File; review: CaptureReview }) {
  const { session } = usePrivateAuth();
  const { api } = useWorkspace();
  const cache = useQueryClient();
  const [profileId, setProfileId] = useState("");
  const [pageOffset, setPageOffset] = useState(0);
  const [attested, setAttested] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busyDownload, setBusyDownload] = useState("");
  const [poseCapture, setPoseCapture] = useState("");
  const scope = session ? [session.organization_id, session.user_id] : [];
  const profiles = useQuery({
    queryKey: ["synthetic-capture-profiles", ...scope],
    queryFn: () => api.profiles("", 0),
    enabled: Boolean(session),
  });
  const consent = useQuery({
    queryKey: ["synthetic-capture-consents", ...scope, profileId],
    queryFn: () => consentsApi(
      session!.organization_id, session!.token, profileId,
    ).history(),
    enabled: Boolean(session && profileId),
  });
  const consentOk = Boolean(["capture", "storage"].every(purpose =>
    consent.data?.items.some(item => item.purpose === purpose && item.effective),
  ));
  const archive = useQuery({
    queryKey: ["synthetic-capture-archive", ...scope, profileId, pageOffset],
    queryFn: () => syntheticCapturesApi(session!.token, profileId).list(pageOffset),
    enabled: Boolean(session && profileId && consentOk),
  });
  useEffect(() => {
    setAttested(false);
    setPoseCapture("");
    setNotice("");
    setError("");
  }, [file, profileId]);
  useEffect(() => {
    if (archive.data && pageOffset >= archive.data.total && pageOffset > 0) {
      setPageOffset(Math.max(0, Math.ceil(archive.data.total /
        CAPTURE_ARCHIVE_PAGE_SIZE) - 1) * CAPTURE_ARCHIVE_PAGE_SIZE);
    }
  }, [archive.data, pageOffset]);
  const poseConsent = Boolean(consent.data?.items.some(item => item.purpose === "pose" && item.effective));
  const canWrite = Boolean(session && session.role !== "member" && consent.data?.can_record);
  const upload = useMutation({
    mutationFn: async () => {
      if (!session || !profileId || !attested || !consentOk) {
        throw new Error("Debes confirmar el expediente, la ficción de la imagen y los consentimientos.");
      }
      const png = await prepareSyntheticPng(file);
      return syntheticCapturesApi(session.token, profileId).create(png);
    },
    onSuccess: async () => {
      setPageOffset(0);
      setAttested(false);
      setError("");
      setNotice("Imagen ficticia cifrada. Caduca en siete días y el servidor privado eliminará los registros vencidos durante sus comprobaciones periódicas.");
      await cache.invalidateQueries({ queryKey: ["synthetic-capture-archive", ...scope, profileId] });
    },
    onError: problem => setError(problem.message),
  });
  const purge = useMutation({
    mutationFn: async () => {
      if (!session || !profileId || !canWrite)
        throw new Error("Se requiere permiso de edición del expediente ficticio.");
      return syntheticCapturesApi(session.token, profileId).purgeExpired();
    },
    onSuccess: async result => {
      setNotice(`Lote de limpieza: ${result.deleted} capturas ficticias vencidas eliminadas de PostgreSQL.`
        + (result.limit_reached
          ? " Se alcanzó el máximo de 100 por operación; podría haber más. Puedes repetir."
          : " No se encontraron más capturas visibles en este lote."));
      setError("");
      await cache.invalidateQueries({ queryKey: ["synthetic-capture-archive", ...scope, profileId] });
    },
    onError: problem => setError(problem.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!session) throw new Error("Se requiere una sesión privada.");
      await syntheticCapturesApi(session.token, profileId).remove(id);
    },
    onSuccess: async () => {
      setNotice("Imagen ficticia borrada de la base de datos de prueba.");
      await cache.invalidateQueries({ queryKey: ["synthetic-capture-archive", ...scope, profileId] });
    },
    onError: problem => setError(problem.message),
  });
  const download = async (id: string) => {
    if (!session) return;
    setBusyDownload(id);
    setError("");
    try {
      const data = await syntheticCapturesApi(session.token, profileId).download(id);
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = "captura-ficticia.png";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "No se pudo recuperar la captura.");
    } finally {
      setBusyDownload("");
    }
  };

  if (!session) return null;
  return (
    <section className="enterprise-panel enterprise-capture-archive"
      aria-label="Archivo cifrado de imágenes ficticias">
      <div className="enterprise-panel-title">
        <h2>Archivo privado de prueba</h2>
        <span>SOLO DATOS FICTICIOS</span>
      </div>
      <p>Esta función es exclusiva del entorno privado local/test. Conserva un PNG
        de prueba cifrado en PostgreSQL, máximo 256 KiB, hasta 7 días.
        No admite imágenes médicas auténticas ni las utiliza para diagnósticos.</p>
      <label>
        Expediente ficticio autorizado
        <select aria-label="Expediente de captura ficticia" value={profileId}
          onChange={event => {
            setPageOffset(0);
            setProfileId(event.target.value);
          }}>
          <option value="">Seleccionar expediente ficticio</option>
          {profiles.data?.items.map(profile => (
            <option key={profile.id} value={profile.id}>
              {profile.display_name || profile.display_code}
            </option>
          ))}
        </select>
      </label>
      {profiles.isError && <p role="alert">No se pudo consultar los expedientes autorizados.</p>}
      {profileId && <div>
        {consent.isPending && <p role="status">Comprobando consentimientos vigentes…</p>}
        {consent.isError && <p role="alert">No se pudieron verificar los consentimientos.</p>}
        {consent.data && !consentOk && <p role="alert">
          Antes de guardar, registra las aceptaciones ficticias vigentes de
          captura y conservación en el expediente.
          {" "}<Link to={`/profiles/${profileId}`}>Revisar consentimientos</Link>
        </p>}
        {consentOk && <p role="status">Aceptaciones ficticias de captura y conservación verificadas.</p>}
      </div>}
      <label className="enterprise-consent">
        <input type="checkbox" checked={attested}
          disabled={!consentOk || !canWrite || upload.isPending}
          onChange={event => setAttested(event.target.checked)} />
        Confirmo que esta imagen es exclusivamente ficticia, que no identifica a una
        persona real y que acepto su almacenamiento temporal de prueba.
      </label>
      <button type="button" className="primary-button"
        disabled={!attested || !consentOk || !canWrite || upload.isPending ||
          !review.passed}
        onClick={() => { setError(""); setNotice(""); upload.mutate(); }}>
        {upload.isPending ? "Cifrando y guardando…" : "Guardar PNG ficticio cifrado"}
      </button>
      {!review.passed && <p>Corrige las advertencias de calidad antes de conservar esta imagen.</p>}
      {profileId && consentOk && <>
        <h3>Capturas cifradas del expediente</h3>
        {canWrite && <div className="enterprise-camera-buttons">
          <button type="button" className="secondary-button"
            disabled={purge.isPending || upload.isPending || remove.isPending}
            onClick={() => { setNotice(""); setError(""); purge.mutate(); }}>
            {purge.isPending ? "Limpiando lote…" : "Eliminar lote de capturas vencidas"}
          </button>
          <small>Solo este expediente ficticio, hasta 100 por solicitud.
            No borra fotos vigentes, respaldos, WAL ni descargas.</small>
        </div>}
        {archive.isPending && <p role="status">Consultando capturas…</p>}
        {archive.isError && <p role="alert">{archive.error.message}</p>}
        {archive.data && <>
          <p role="status" aria-label="Página del archivo cifrado">
            {archive.data.total > 0
              ? `Capturas ${pageOffset + 1}–${pageOffset + archive.data.items.length} de ${archive.data.total}`
              : "0 capturas ficticias vigentes"}
          </p>
          {archive.data.items.length ? (
          <ol className="enterprise-capture-archive-list">
            {archive.data.items.map(item => (
              <li key={item.id}>
                <strong>SIMULADO · {item.width} × {item.height} px</strong>
                <small>Guardado: {dateTime(item.created_at)} · Vence: {dateTime(item.expires_at)}</small>
                <div className="enterprise-camera-buttons">
                  <button type="button" className="secondary-button"
                    disabled={busyDownload === item.id}
                    onClick={() => void download(item.id)}>
                    Descargar PNG
                  </button>
                  {poseConsent && <button type="button" className="secondary-button"
                    onClick={() => setPoseCapture(poseCapture === item.id ? "" : item.id)}>
                    {poseCapture === item.id ? "Cerrar análisis de servidor" : "Análisis de pose en servidor"}
                  </button>}
                  {canWrite && <button type="button" className="secondary-button"
                    disabled={remove.isPending}
                    onClick={() => {
                      setError("");
                      remove.mutate(item.id);
                    }}>
                    Borrar definitivamente
                  </button>}
                </div>
                {poseConsent && poseCapture === item.id && <ServerPosePanel
                  key={`${session.user_id}-${profileId}-${item.id}`} token={session.token} profileId={profileId}
                  organizationId={session.organization_id} actorId={session.user_id}
                  captureId={item.id} canWrite={canWrite} />}
              </li>
            ))}
          </ol>
        ) : <p>{archive.data.total === 0
          ? "No hay PNG ficticios guardados en este expediente."
          : "No hay capturas en esta página. Vuelve a la anterior."}</p>}
          <div className="enterprise-camera-buttons" aria-label="Paginación de capturas ficticias">
            <button type="button" className="secondary-button"
              disabled={pageOffset === 0 || archive.isFetching}
              onClick={() => setPageOffset(Math.max(0, pageOffset - CAPTURE_ARCHIVE_PAGE_SIZE))}>
              Anterior
            </button>
            <button type="button" className="secondary-button"
              disabled={archive.isFetching ||
                pageOffset + CAPTURE_ARCHIVE_PAGE_SIZE >= archive.data.total}
              onClick={() => setPageOffset(pageOffset + CAPTURE_ARCHIVE_PAGE_SIZE)}>
              Siguiente
            </button>
          </div>
        </>}
      </>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <small>La revocación de captura o conservación borra los objetos cifrados.
        La caducidad bloquea su descarga; el servidor privado elimina registros
        vencidos periódicamente mientras está funcionando. Esto no garantiza el
        borrado inmediato de copias de seguridad o WAL. No se conservan archivos
        en el almacenamiento persistente del navegador.</small>
    </section>
  );
}
