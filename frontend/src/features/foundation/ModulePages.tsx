import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { csvPreview, ProfilePicker } from "./ModuleControls";
import { reviewLocalCapture, type CaptureReview } from "../capture/captureQuality";
import { PoseReview } from "../capture/PoseReview";
import { SyntheticCaptureArchive } from "../capture/SyntheticCaptureArchive";
import { SandboxCaptureLibrary } from "../capture/SandboxCaptureLibrary";
import { discardStagedCapture, peekCaptureForAnalysis, stageCaptureForAnalysis } from "../capture/captureHandoff";
import { useWorkspace } from "../../app/providers/WorkspaceProvider";
import { privateAuthEnabled, sandboxAuthEnabled } from "../../app/providers/PrivateAuthProvider";
import { SandboxAccessPage } from "../access/SandboxAccessPage";
import { PrivateAccessPage } from "../access/PrivateAccessPage";
import { PrivateAdministrationPage } from "../access/PrivateAdministrationPage";
import { ErrorState, LoadingState, dateTime } from "../../components/ui/States";

function PageTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="enterprise-page-head"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div></div>;
}
function Limitation({ children }: { children: ReactNode }) {
  return <div className="enterprise-limit"><strong>Información</strong><p>{children}</p></div>;
}
export function MeasurementsPage() {
  const { id, api } = useWorkspace();
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const profiles = useQuery({ queryKey: ["profiles", id, "measurements", search, offset], queryFn: () => api.profiles(search, offset) });
  const metrics = useQuery({ queryKey: ["catalog", id], queryFn: api.catalog });
  return <div className="enterprise-module">
    <PageTitle eyebrow="MEDICIONES" title="Registro de mediciones" description="Consulta y registra medidas corporales." />
    <div className="enterprise-module-columns">
      <section className="enterprise-panel enterprise-module-main">
        <div className="enterprise-panel-title"><h2>Selecciona un expediente</h2><Link to="/profiles">Ver todos →</Link></div>
        <label className="search-label">Buscar expediente<input value={search} maxLength={100} onChange={e => { setSearch(e.target.value); setOffset(0); }} /></label>
        {profiles.isPending ? <LoadingState/> : profiles.isError ? <ErrorState error={profiles.error} retry={() => void profiles.refetch()}/> :
          profiles.data.items.length ? <div className="enterprise-record-links">
            {profiles.data.items.map(profile => <Link to={"/profiles/" + profile.id + "?tab=measurements"} key={profile.id}>
              <span className="enterprise-mini-avatar">◉</span><span><strong>{profile.display_name || profile.display_code}</strong><small>{profile.display_code} · {profile.status === "active" ? "Activo" : "Consulta restringida"}</small></span><span>Continuar →</span>
            </Link>)}
          </div> : <p className="enterprise-hint">No hay expedientes disponibles para esta búsqueda.</p>}
        {profiles.data && <ProfilePicker.Pagination page={profiles.data} onChange={setOffset} label="Páginas de expedientes de mediciones" />}
      </section>
      <aside className="enterprise-panel enterprise-module-side">
        <h2>Catálogo de medición</h2>
        {metrics.isPending ? <p className="enterprise-hint">Cargando métricas…</p> : metrics.isError ? <ErrorState error={metrics.error} retry={()=>void metrics.refetch()}/> :
        <div className="enterprise-metric-list">{metrics.data.map(metric=><div key={metric.code}><strong>{metric.label}</strong><span>{metric.unit} · {metric.allowed_methods.map(method=>method==="manual"?"Manual":"Dispositivo").join(", ")}</span><small>Rango: {metric.min_value}–{metric.max_value} {metric.unit} · {metric.precision} decimales</small></div>)}</div>}
        <Limitation>Selecciona un expediente para registrar mediciones.</Limitation>
      </aside>
    </div>
  </div>;
}

export function CapturePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const cameraRequest = useRef(0);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraPending, setCameraPending] = useState(false);
  const [photoPending, setPhotoPending] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [consent, setConsent] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [review, setReview] = useState<CaptureReview | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [validationError, setValidationError] = useState("");

  const closeCamera = () => {
    cameraRequest.current += 1;
    cameraStream.current?.getTracks().forEach(track => track.stop());
    cameraStream.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
    setCameraReady(false);
    setCameraPending(false);
    setPhotoPending(false);
  };
  useEffect(() => {
    return () => {
      cameraRequest.current += 1;
      cameraStream.current?.getTracks().forEach(track => track.stop());
      cameraStream.current = null;
    };
  }, []);
  useEffect(() => {
    if (!cameraOn || !videoRef.current || !cameraStream.current) return;
    videoRef.current.srcObject = cameraStream.current;
    void videoRef.current.play().catch(() => {
      setValidationError("No se pudo mostrar la cámara. Comprueba los permisos.");
    });
  }, [cameraOn]);

  const openCamera = async () => {
    if (!consent || cameraPending || cameraOn) return;
    setValidationError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setValidationError("Este navegador no permite la cámara. Usa una conexión HTTPS o localhost.");
      return;
    }
    const pending = ++cameraRequest.current;
    setCameraPending(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 1920 } },
      });
      if (pending !== cameraRequest.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      cameraStream.current = stream;
      setCameraReady(false);
      setCameraOn(true);
    } catch {
      if (pending === cameraRequest.current) {
        setValidationError("No se pudo acceder a la cámara. Revisa el permiso y el dispositivo.");
      }
    } finally {
      if (pending === cameraRequest.current) setCameraPending(false);
    }
  };

  const takePhoto = async () => {
    const video = videoRef.current;
    if (!video || !cameraReady || photoPending || !video.videoWidth || !video.videoHeight) return;
    const generation = cameraRequest.current;
    const canvas = document.createElement("canvas");
    const factor = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * factor);
    canvas.height = Math.round(video.videoHeight * factor);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setValidationError("No se pudo preparar la fotografía.");
      return;
    }
    setPhotoPending(true);
    let photo: Blob | null = null;
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      photo = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.87));
    } catch { /* handled as an unsuccessful capture below */ }
    finally { canvas.width = canvas.height = 0; }
    if (generation !== cameraRequest.current) return;
    setPhotoPending(false);
    if (!photo || photo.size > 10 * 1024 * 1024) {
      setValidationError("No se pudo capturar la fotografía dentro del límite de 10 MB.");
      return;
    }
    closeCamera();
    setFile(new File([photo], "captura-local.jpg", { type: "image/jpeg" }));
  };

  useEffect(() => {
    if (!file) {
      setPreview("");
      setReview(null);
      setIsReviewing(false);
      return;
    }
    let active = true;
    const url = URL.createObjectURL(file);
    setPreview(url);
    setReview(null);
    setIsReviewing(true);
    setValidationError("");
    void reviewLocalCapture(file)
      .then(result => {
        if (!active) return;
        setReview(result);
        setIsReviewing(false);
      })
      .catch(error => {
        if (!active) return;
        setReview(null);
        setIsReviewing(false);
        setFile(null);
        setValidationError(error instanceof Error ? error.message : "La imagen no pudo revisarse.");
      });
    return () => { active = false; URL.revokeObjectURL(url); };
  }, [file]);
  const fileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    closeCamera();
    setValidationError("");
    setReview(null);
    if (next && !["image/jpeg", "image/png", "image/webp"].includes(next.type)) {
      setFile(null);
      setValidationError("Selecciona una imagen JPG, PNG o WebP.");
    } else if (next && (next.size === 0 || next.size > 10 * 1024 * 1024)) {
      setFile(null);
      setValidationError("La imagen debe ocupar más de 0 bytes y menos de 10 MB.");
    } else {
      setFile(next);
    }
    event.target.value = "";
  };
  return <div className="enterprise-module">
    <PageTitle eyebrow="CAPTURA GUIADA" title="Captura corporal" description="Selecciona una imagen ficticia y revisa su calidad."/>
    <div className="enterprise-capture-grid">
      <section className="enterprise-panel enterprise-module-main">
        <div className="enterprise-panel-title"><h2>Guía de toma fotográfica</h2><span>RECOMENDACIONES</span></div>
        <div className="enterprise-capture-steps">
          <article><span>01</span><div><h3>Consentimiento</h3><p>Utiliza imágenes ficticias y confirma tu consentimiento.</p></div></article>
          <article><span>02</span><div><h3>Postura y encuadre</h3><p>Cuerpo entero, brazos separados y fondo despejado.</p></div></article>
          <article><span>03</span><div><h3>Iluminación y resolución</h3><p>Buena iluminación, sin filtros ni recortes.</p></div></article>
          <article><span>04</span><div><h3>Revisión y trazabilidad</h3><p>Revisa la calidad antes de continuar.</p></div></article>
        </div>
        <label className="enterprise-consent"><input type="checkbox" checked={consent} onChange={e => {
          setConsent(e.target.checked);
          if (!e.target.checked) {
            closeCamera();
            setFile(null);
            setValidationError("");
          }
        }} />
          <span>Confirmo que utilizaré exclusivamente imágenes ficticias. La revisión es local.</span>
        </label>
        <label className={"enterprise-upload" + (consent ? "" : " disabled")}>
          <span>＋</span><strong>Seleccionar imagen para revisión local</strong><small>JPG, PNG o WebP · hasta 10 MB</small>
          <input type="file" accept="image/jpeg,image/png,image/webp" disabled={!consent} onChange={fileChange}/>
        </label>
        <div className="enterprise-camera-controls">
          {!cameraOn ? (
            <button type="button" className="secondary-button" disabled={!consent || cameraPending}
              onClick={() => void openCamera()}>{cameraPending ? "Solicitando permiso…" : "Abrir cámara local"}</button>
          ) : (
            <div className="enterprise-camera-session">
              <video ref={videoRef} playsInline muted autoPlay
                aria-label="Vista en vivo de la cámara sin transmisión"
                onLoadedMetadata={() => setCameraReady(true)} />
              <p>Vista privada en este dispositivo.</p>
              <div className="enterprise-camera-buttons">
                <button type="button" className="primary-button" disabled={!cameraReady || photoPending}
                  onClick={() => void takePhoto()}>{photoPending ? "Preparando fotografía…" : "Tomar fotografía"}</button>
                <button type="button" className="secondary-button"
                  onClick={closeCamera}>Cerrar cámara</button>
              </div>
            </div>
          )}
          {cameraPending && <button type="button" className="secondary-button" onClick={closeCamera}>Cancelar solicitud de cámara</button>}
        </div>
      </section>
      <aside className="enterprise-panel enterprise-module-side">
        <h2>Vista previa de captura</h2>
        {preview && file ? <>
          <img className="enterprise-capture-preview" src={preview} alt="Vista previa local de la imagen seleccionada"/>
          <p className="enterprise-file-detail">{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</p>
          {isReviewing && <p role="status" className="enterprise-quality-note">Revisando la calidad localmente…</p>}
          {validationError && <p role="alert" className="enterprise-quality-note">{validationError}</p>}
          {review && !isReviewing && <div className="enterprise-quality-review" role="region" aria-label="Resultados de calidad local">
            <h3>Revisión automática de calidad</h3>
            <p className="enterprise-file-detail">{review.width} × {review.height} px · Brillo {review.averageBrightness}/255 · Contraste {review.contrast}/128</p>
            <p role="status" className="enterprise-quality-note">{review.passed
              ? "Sin alertas técnicas básicas. La postura y la presencia de un cuerpo NO se han comprobado."
              : "Se encontraron condiciones que conviene mejorar antes de una futura estimación de pose."}</p>
            <ul>{review.checks.map(check => <li key={check.id}>
              <strong>{check.passed ? "✓" : "!"} {check.label}</strong>
              <span>{check.detail}</span>
            </li>)}</ul>
            <Link className="secondary-button" to="/analysis" state={{ localCaptureReview: review }}
              onClick={() => stageCaptureForAnalysis(file, review)}>
              Ver control de calidad en el módulo de análisis
            </Link>
          </div>}
          {privateAuthEnabled() && review && !isReviewing && <SyntheticCaptureArchive file={file} review={review}/>}
          <button className="secondary-button" onClick={() => setFile(null)}>Descartar imagen</button>
        </> : <div className="enterprise-capture-placeholder"><span>◫</span><strong>Sin imagen seleccionada</strong><p>Selecciona una imagen o abre la cámara.</p></div>}
        {!file && validationError && <p role="alert" className="enterprise-quality-note">{validationError}</p>}
        <Limitation>Solo imágenes ficticias. No apto para uso clínico.</Limitation>
      </aside>
    </div>
    {sandboxAuthEnabled() && <SandboxCaptureLibrary file={file} allowUpload={Boolean(consent && file && review?.passed && !isReviewing)} />}
  </div>;
}

export function AnalysisPage() {
  const location = useLocation();
  const [localCapture, setLocalCapture] = useState(() => peekCaptureForAnalysis());
  useEffect(() => { discardStagedCapture(); }, []);
  const state = location.state as { localCaptureReview?: CaptureReview } | null;
  const [discarded, setDiscarded] = useState(false);
  const [directConsent,setDirectConsent] = useState(false);
  const [directPending,setDirectPending] = useState(false);
  const [directError,setDirectError] = useState("");
  const generation = useRef(0);
  useEffect(()=>()=>{generation.current+=1;},[]);
  const selectDirect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file=event.target.files?.[0];
    event.target.value="";
    if(!directConsent || !file) return;
    const current=++generation.current;
    setDirectPending(true);setDirectError("");setLocalCapture(null);setDiscarded(true);
    try {
      const review=await reviewLocalCapture(file);
      if(current!==generation.current) return;
      setLocalCapture({file,review});setDiscarded(false);
    } catch(error) {
      if(current===generation.current) setDirectError(error instanceof Error?error.message:"No se pudo revisar la imagen.");
    } finally {
      if(current===generation.current) setDirectPending(false);
    }
  };
  const localReview = discarded ? null : localCapture?.review ?? (state?.localCaptureReview?.checks?.length === 4
    ? state.localCaptureReview : null);
  const stages = [
    { name:"Autorización", detail:"Consentimiento para la imagen", status:"Pendiente para uso real" },
    { name:"Control de calidad", detail:"Resolución, orientación, contraste e iluminación", status:"Revisión local disponible" },
    { name:"Detección de pose", detail:"Hasta 33 puntos corporales", status:"Disponible" },
    { name:"Revisión humana", detail:"Revisión de resultados", status:"Pendiente para uso real" },
  ];
  return <div className="enterprise-module">
    <PageTitle eyebrow="VISIÓN POR COMPUTADORA" title="Análisis corporal con IA" description="Evalúa la postura y los puntos corporales de una imagen ficticia."/>
    <div className="enterprise-module-columns enterprise-analysis-layout">
      <section className="enterprise-panel enterprise-module-main">
        <div className="enterprise-panel-title"><h2>Revisión visual de postura</h2><span>{localCapture ? "CAPTURA SELECCIONADA" : "REFERENCIA VISUAL"}</span></div>
        {localReview && <div className="enterprise-quality-review enterprise-review-handoff" role="region" aria-label="Control de calidad recibido">
          <h3>Control técnico de la captura</h3>
          <p>{localReview.width} × {localReview.height} px · {localReview.checks.filter(item => item.passed).length} de 4 criterios cumplidos.</p>
          <ul>{localReview.checks.map(check => <li key={check.id}>
            <strong>{check.passed ? "✓" : "!"} {check.label}</strong><span>{check.detail}</span>
          </li>)}</ul>
          <p className="enterprise-hint">La imagen permanece únicamente en la memoria de esta pestaña, sin subirse a la API ni guardarse en el historial del navegador. El control de calidad no confirma consentimiento clínico.</p>
        </div>}
        {localCapture && <>
          <PoseReview file={localCapture.file} review={localCapture.review} />
          <button type="button" className="secondary-button" onClick={() => { generation.current+=1; setLocalCapture(null); setDiscarded(true); setDirectConsent(false); }}>
            Descartar fotografía del análisis
          </button>
        </>}
        {sandboxAuthEnabled() && <SandboxCaptureLibrary file={localCapture?.file??null} allowUpload={Boolean(localCapture?.review.passed)} onAnalyze={async (file,review)=>{generation.current+=1;setLocalCapture({file,review});setDiscarded(false);setDirectPending(false);setDirectError("");}}/>}
        {!localCapture && <div className="enterprise-quality-review">
          <h3>Seleccionar imagen para análisis</h3>
          <label className="enterprise-consent"><input type="checkbox" checked={directConsent} onChange={event=>{
            setDirectConsent(event.target.checked);
            if(!event.target.checked){generation.current+=1;setDirectPending(false);setDirectError("");}
          }}/><span>Confirmo que utilizaré exclusivamente imágenes ficticias.</span></label>
          <label className="enterprise-upload"><strong>Cargar imagen</strong><small>JPG, PNG o WebP · revisión local</small>
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={!directConsent||directPending} onChange={event=>void selectDirect(event)}/>
          </label>
          {directPending && <p role="status">Revisando imagen…</p>}
          {directError && <p role="alert">{directError}</p>}
        </div>}
        {!localCapture && <div className="enterprise-pose-visual">
          <div className="enterprise-pose-model">
            <svg viewBox="0 0 220 360" aria-label="Esquema de puntos corporales, no resultado de inteligencia artificial" role="img">
              <g stroke="#70ebee" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d="M110 50L110 83L74 111L52 171L38 235M110 83L146 111L170 171L184 235M74 111L146 111M74 111L91 214L110 238L129 214L146 111M91 214L84 287L77 340M129 214L136 287L143 340"/>
                <path d="M91 214L129 214"/>
              </g>
              <circle cx="110" cy="33" r="21" fill="#2089bd" fillOpacity=".3" stroke="#7eeaf5" strokeWidth="2"/>
              <g fill="#9aebff">{[[110,50],[110,83],[74,111],[146,111],[52,171],[170,171],[38,235],[184,235],[91,214],[129,214],[84,287],[136,287],[77,340],[143,340]].map(([x,y],i)=><circle key={i} cx={x} cy={y} r="5" stroke="#0c2c48" strokeWidth="2"/>)}</g>
            </svg>
            <span>ILUSTRACIÓN · SIN DATOS DE PERSONAS</span>
          </div>
          <div><p className="enterprise-hint">Prepara una captura para detectar puntos corporales.</p><Link className="primary-button" to="/capture">Preparar captura ↗</Link></div>
        </div>}
      </section>
      <aside className="enterprise-panel enterprise-module-side">
        <h2>Etapas del análisis</h2>
        <div className="enterprise-stage-list">{stages.map((stage,index)=><div key={stage.name}><span>{String(index+1).padStart(2,"0")}</span><div><strong>{stage.name}</strong><p>{stage.detail}</p><small>{stage.status}</small></div></div>)}</div>
        <Limitation>La detección de pose no mide composición corporal ni realiza diagnósticos.</Limitation>
      </aside>
    </div>
  </div>;
}

export function ReportsPage() {
  const {id,api} = useWorkspace();
  const location=useLocation();
  const [profileId,setProfileId] = useState(()=>new URLSearchParams(location.search).get("profile")??"");
  const [offset,setOffset] = useState(0);
  const [reportMetric,setReportMetric] = useState("");
  const catalog=useQuery({queryKey:["catalog",id],queryFn:api.catalog});
  const selected=useQuery({queryKey:["report-profile",id,profileId],queryFn:()=>api.profile(profileId),enabled:!!profileId});
  const measurements=useQuery({queryKey:["report-measurements",id,profileId,offset,reportMetric],queryFn:()=>api.measurements(profileId,reportMetric,offset),enabled:!!profileId});
  const derived=useQuery({queryKey:["report-derived",id,profileId],queryFn:()=>api.derived(profileId),enabled:!!profileId});
  const current=selected.data;
  const ready=selected.isSuccess && measurements.isSuccess && derived.isSuccess &&
    !selected.isFetching && !measurements.isFetching && !derived.isFetching;
  const exportCsv=()=>{
    if (!ready || privateAuthEnabled() || !measurements.data?.items.length) return;
    const url=URL.createObjectURL(new Blob([csvPreview(measurements.data.items)],{type:"text/csv;charset=utf-8"}));
    const anchor=document.createElement("a");
    anchor.href=url;anchor.download="bodyvision_mediciones_ficticias.csv";
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <div className="enterprise-module">
    <PageTitle eyebrow="INFORMES" title="Reportes corporales" description="Consulta y exporta mediciones corporales."/>
    <section className="enterprise-panel enterprise-report-builder">
      <div><h2>Preparar informe</h2><ProfilePicker selected={current ?? null} selectedId={profileId}
        onChange={next=>{setProfileId(next);setOffset(0);}} />
        <label>Métrica del informe<select value={reportMetric} disabled={!catalog.data} onChange={event=>{setReportMetric(event.target.value);setOffset(0);}}><option value="">Todas las métricas</option>{catalog.data?.map(m=><option key={m.code} value={m.code}>{m.label} ({m.unit})</option>)}</select></label>
        {catalog.isError && <ErrorState error={catalog.error} retry={()=>void catalog.refetch()}/>}
      </div>
      <div className="enterprise-report-actions">
        {privateAuthEnabled() ? <>{ready && <Link className="secondary-button" to={"/profiles/"+profileId+"?tab=analytics"}>Abrir informes con auditoría (PDF/CSV)</Link>}</> :
          <button disabled={!ready || !measurements.data?.items.length} onClick={exportCsv}>Exportar registros visibles (CSV)</button>}
        {!privateAuthEnabled() && <button disabled={!ready} onClick={()=>window.print()}>Imprimir vista previa</button>}
        {sandboxAuthEnabled()&&ready&&<Link className="secondary-button" to={"/profiles/"+profileId+"?tab=images"}>Imágenes de referencia del expediente</Link>}
      </div>
    </section>
    <section className="enterprise-panel enterprise-report-preview">
      <div className="enterprise-panel-title"><h2>Vista previa del informe</h2><span>FICTICIO · NO MÉDICO</span></div>
      {!profileId ? <p className="enterprise-hint">Selecciona un expediente para generar una vista previa con datos existentes del servicio.</p> :
        selected.isError || measurements.isError || derived.isError ? <ErrorState error={selected.error ?? measurements.error ?? derived.error} retry={()=>{void selected.refetch();void measurements.refetch();void derived.refetch();}}/> :
        !ready ? <LoadingState/> :
        <><h3>{current?.display_name || current?.display_code || "Expediente"}</h3>
          <p className="enterprise-hint">Código: {current?.display_code} · Fecha del informe: {new Date().toLocaleDateString("es-PE",{timeZone:"America/Lima"})}. Mediciones registradas y cálculos derivados.</p>
          <h4>Mediciones observadas</h4>
          {measurements.data && <ProfilePicker.Pagination page={measurements.data} onChange={setOffset} label="Páginas de mediciones del informe" />}
          {measurements.data?.items.length === 0 && <p className="enterprise-hint">No hay mediciones observadas para mostrar.</p>}
          <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Métrica</th><th>Valor</th><th>Método</th><th>Responsable</th></tr></thead><tbody>
            {measurements.data?.items.map(m=><tr key={m.id}><td>{dateTime(m.measured_at)}</td><td>{catalog.data?.find(item=>item.code===m.metric_code)?.label??m.metric_code}</td><td>{m.value} {m.unit}</td><td>{m.method==="manual"?"Manual":"Dispositivo"}</td><td>{m.responsible}</td></tr>)}
          </tbody></table></div>
          <h4>Cálculos derivados</h4>
          <div className="enterprise-derived-row">{derived.data?.map(d=><div key={d.metric_code}><span>{d.label}</span><strong>{d.value===null?"Sin datos":d.value.toFixed(2)+" "+d.unit}</strong><small>{d.formula}</small>{d.reason&&<small>{d.reason}</small>}<small>Fuentes: {d.source_measurement_ids.length} mediciones · {dateTime(d.as_of)}</small></div>)}</div>
        </>}
      <Limitation>Vista de la página seleccionada. Informes completos en Evolución del expediente.</Limitation>
    </section>
  </div>;
}
export function AdministrationPage() {
  if (privateAuthEnabled()) return <PrivateAdministrationPage />;
  return <div className="enterprise-module">
    <PageTitle eyebrow="ADMINISTRACIÓN" title="Administración y seguridad" description="Gestiona el acceso y la privacidad."/>
    <div className="enterprise-admin-grid">
      {[
        ["Usuarios y roles","Administrador, especialista y usuario final. Permisos granulares por expediente.","SOLO ACCESO PRIVADO"],
        ["Consentimiento informado","Versión, propósito, fecha, revocación y bloqueo de procesamiento.","SOLO ACCESO PRIVADO"],
        ["Auditoría","Eventos de lectura, edición, consulta, exportación e incidencias de acceso.","SOLO ACCESO PRIVADO"],
        ["Privacidad y retención","Cifrado, almacenamiento privado, políticas de borrado y autorización.","SOLO ACCESO PRIVADO"],
      ].map(([title,description,status])=><article className="enterprise-panel" key={title}><span>◈</span><h2>{title}</h2><p>{description}</p><small>{status}</small></article>)}
    </div>
    <div className="enterprise-panel enterprise-admin-note"><strong>Seguridad actual</strong><p>Los ajustes de seguridad están disponibles en el espacio privado.</p><Link to="/access">Consultar acceso ↗</Link></div>
  </div>;
}
export function AccessPage() {
  if (sandboxAuthEnabled()) return <SandboxAccessPage/>;
  if (privateAuthEnabled()) return <PrivateAccessPage />;
  return <div className="enterprise-access">
    <div className="enterprise-access-art"><span>BODYVISION AI</span><h1>Un espacio profesional para explorar el cuerpo.</h1><p>Mediciones, visión anatómica y trazabilidad en una plataforma web.</p><div className="enterprise-access-orbit" aria-hidden="true">✧</div></div>
    <section className="enterprise-access-card"><span className="eyebrow">ACCESO PROFESIONAL</span><h2>Identificación de usuario</h2><p>Acceso privado no disponible en esta demostración.</p>
      <label>Correo electrónico<input type="email" placeholder="usuario@organizacion.com" disabled/></label>
      <label>Contraseña<input type="password" placeholder="••••••••" disabled/></label>
      <button disabled>Inicio de sesión deshabilitado en demostración</button>
      <p>Explora la plataforma con datos ficticios.</p>
      <Link to="/">Entrar a la demostración →</Link>
    </section>
  </div>;
}
