import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useWorkspace } from "../../app/providers/WorkspaceProvider";
import { ErrorState, LoadingState, dateTime } from "../../components/ui/States";

function PageTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="enterprise-page-head"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div></div>;
}
function Limitation({ children }: { children: ReactNode }) {
  return <div className="enterprise-limit"><strong>ESTADO DEL MÓDULO</strong><p>{children}</p></div>;
}
export function MeasurementsPage() {
  const { id, api } = useWorkspace();
  const profiles = useQuery({ queryKey: ["profiles", id, "measurements"], queryFn: () => api.profiles("", 0) });
  const metrics = useQuery({ queryKey: ["catalog", id], queryFn: api.catalog });
  return <div className="enterprise-module">
    <PageTitle eyebrow="MEDICIONES OBSERVADAS" title="Registro de mediciones" description="Consulta y añade valores con fecha, unidad, método y responsable. Las correcciones se versionan." />
    <div className="enterprise-module-columns">
      <section className="enterprise-panel enterprise-module-main">
        <div className="enterprise-panel-title"><h2>Selecciona un expediente</h2><Link to="/profiles">Ver todos →</Link></div>
        {profiles.isPending ? <LoadingState/> : profiles.isError ? <ErrorState error={profiles.error} retry={() => void profiles.refetch()}/> :
          profiles.data.items.length ? <div className="enterprise-record-links">
            {profiles.data.items.map(profile => <Link to={"/profiles/" + profile.id + "?tab=measurements"} key={profile.id}>
              <span className="enterprise-mini-avatar">◉</span><span><strong>{profile.display_name || profile.display_code}</strong><small>{profile.display_code} · {profile.status === "active" ? "Activo" : "Consulta restringida"}</small></span><span>Continuar →</span>
            </Link>)}
          </div> : <p className="enterprise-hint">No hay expedientes disponibles. Crea un expediente ficticio antes de registrar medidas.</p>}
      </section>
      <aside className="enterprise-panel enterprise-module-side">
        <h2>Catálogo de medición</h2>
        {metrics.isPending ? <p className="enterprise-hint">Cargando métricas…</p> : metrics.isError ? <p className="enterprise-hint">Catálogo no disponible.</p> :
        <div className="enterprise-metric-list">{metrics.data.map(metric=><div key={metric.code}><strong>{metric.label}</strong><span>{metric.unit} · {metric.allowed_methods.join(", ")}</span></div>)}</div>}
        <Limitation>Las mediciones se introducen en cada expediente, no sobre el modelo anatómico genérico.</Limitation>
      </aside>
    </div>
  </div>;
}

export function CapturePage() {
  const [consent, setConsent] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [details, setDetails] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (!file) { setPreview(""); setDetails(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const fileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    setFile(next && next.type.startsWith("image/") && next.size <= 10 * 1024 * 1024 ? next : null);
    event.target.value = "";
  };
  const imageWarning = details && (Math.min(details.width, details.height) < 720 ?
    "Resolución baja para un análisis de pose fiable." : "Resolución suficiente para continuar con una validación técnica; aún no se evaluó la postura.");
  return <div className="enterprise-module">
    <PageTitle eyebrow="CAPTURA GUIADA · PRIVACIDAD PRIMERO" title="Captura corporal" description="Prepara fotografías con postura, encuadre y luz uniformes. El documento exige consentimiento antes de almacenarlas o analizarlas."/>
    <div className="enterprise-capture-grid">
      <section className="enterprise-panel enterprise-module-main">
        <div className="enterprise-panel-title"><h2>Guía de toma fotográfica</h2><span>ANTES DE PROCESAR</span></div>
        <div className="enterprise-capture-steps">
          <article><span>01</span><div><h3>Consentimiento</h3><p>Informa del propósito, uso, protección y periodo de conservación. Confirma autorización para tratar las imágenes.</p></div></article>
          <article><span>02</span><div><h3>Postura y encuadre</h3><p>De pie, cuerpo entero visible, brazos ligeramente separados y fondo despejado. Toma vistas frontal y lateral cuando corresponda.</p></div></article>
          <article><span>03</span><div><h3>Iluminación y resolución</h3><p>Evita contraluz, sombras duras, filtros y recortes. Comprueba que pies, cabeza y extremidades estén dentro del encuadre.</p></div></article>
          <article><span>04</span><div><h3>Revisión y trazabilidad</h3><p>Asocia la captura a un expediente autorizado y conserva fuente, fecha, método y resultado de calidad.</p></div></article>
        </div>
        <label className="enterprise-consent"><input type="checkbox" checked={consent} onChange={e => { setConsent(e.target.checked); if (!e.target.checked) setFile(null); }} />
          <span>Confirmo que utilizaré exclusivamente imágenes ficticias o expresamente autorizadas. En esta fase solo se previsualizarán en mi navegador.</span>
        </label>
        <label className={"enterprise-upload" + (consent ? "" : " disabled")}>
          <span>＋</span><strong>Seleccionar imagen para revisión local</strong><small>JPG, PNG o WebP · máximo 10 MB · sin subida al servidor</small>
          <input type="file" accept="image/jpeg,image/png,image/webp" disabled={!consent} onChange={fileChange}/>
        </label>
      </section>
      <aside className="enterprise-panel enterprise-module-side">
        <h2>Vista previa de captura</h2>
        {preview && file ? <>
          <img className="enterprise-capture-preview" src={preview} alt="Vista previa local de la imagen seleccionada" onLoad={e => setDetails({ width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight })}/>
          <p className="enterprise-file-detail">{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</p>
          {details && <p className="enterprise-file-detail">{details.width} × {details.height} píxeles</p>}
          {imageWarning && <p className="enterprise-quality-note">{imageWarning}</p>}
          <button className="secondary-button" onClick={() => setFile(null)}>Descartar imagen</button>
        </> : <div className="enterprise-capture-placeholder"><span>◫</span><strong>Sin imagen seleccionada</strong><p>La vista previa aparecerá aquí sin enviar archivos a la API.</p></div>}
        <Limitation>La subida privada, el registro de consentimiento y la validación automática de calidad aún requieren backend y control de acceso. No introduzcas fotografías médicas reales.</Limitation>
      </aside>
    </div>
  </div>;
}

export function AnalysisPage() {
  const stages = [
    { name:"Autorización", detail:"Comprobación del expediente y consentimiento", status:"Pendiente de implementar" },
    { name:"Control de calidad", detail:"Encuadre, resolución, iluminación y postura", status:"Pendiente de implementar" },
    { name:"Detección de pose", detail:"MediaPipe Pose Landmarker y coordenadas", status:"Pendiente de implementar" },
    { name:"Revisión humana", detail:"Landmarks, versión del modelo y alertas de calidad", status:"Pendiente de implementar" },
  ];
  return <div className="enterprise-module">
    <PageTitle eyebrow="VISIÓN POR COMPUTADORA" title="Análisis corporal con IA" description="La documentación plantea identificar puntos de pose a partir de imágenes autorizadas, con control de calidad y resultados trazables."/>
    <div className="enterprise-module-columns enterprise-analysis-layout">
      <section className="enterprise-panel enterprise-module-main">
        <div className="enterprise-panel-title"><h2>Revisión visual de postura</h2><span>ESQUEMA EXPLICATIVO</span></div>
        <div className="enterprise-pose-visual">
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
          <div><p className="enterprise-hint">Los colores y puntos son únicamente una referencia de interfaz. No se han detectado landmarks ni calculado composición corporal.</p><Link className="primary-button" to="/capture">Preparar captura ↗</Link></div>
        </div>
      </section>
      <aside className="enterprise-panel enterprise-module-side">
        <h2>Flujo de análisis esperado</h2>
        <div className="enterprise-stage-list">{stages.map((stage,index)=><div key={stage.name}><span>{String(index+1).padStart(2,"0")}</span><div><strong>{stage.name}</strong><p>{stage.detail}</p><small>{stage.status}</small></div></div>)}</div>
        <Limitation>No se deben mostrar IMC estimado, grasa corporal, masa muscular ni mapas térmicos como resultados de IA sin un modelo ejecutado y validación apropiada.</Limitation>
      </aside>
    </div>
  </div>;
}

function HumanOutline({ ratio, heightScale = 1 }: { ratio: number; heightScale?: number }) {
  return <svg className="enterprise-sim-body" viewBox="0 0 220 340" role="img" aria-label="Silueta esquemática, no reconstrucción de una persona">
    <path d="M93 52Q83 24 105 14Q126 10 133 33L127 57L138 70L165 83L184 139L193 185L180 190L165 150L152 118L151 190L138 207L132 283L128 326L110 326L107 263L102 216L96 263L91 326L72 326L75 283L65 207L66 190L67 118L54 150L39 190L26 185L35 139L54 83L82 70Z"
      fill="#348fc2" fillOpacity=".27" stroke="#71d7ed" strokeWidth="2" style={{ transformOrigin:"110px 175px",transform:"scale("+ratio+", "+heightScale+")" }}/>
    <path d="M110 57V211M83 86L138 86M66 126L151 126M75 206L139 206" stroke="#71cced" opacity=".4" strokeWidth="2"/>
  </svg>;
}

export function SimulationPage() {
  const [weightChange, setWeightChange] = useState(0);
  const [muscleChange, setMuscleChange] = useState(0);
  const [height, setHeight] = useState(175);
  const [saved, setSaved] = useState<{weight:number;muscle:number;height:number}|null>(null);
  const ratio = Math.max(.82,Math.min(1.18,1 + weightChange / 240 + muscleChange / 400));
  return <div className="enterprise-module">
    <PageTitle eyebrow="SIMULACIÓN · ESCENARIO HIPOTÉTICO" title="Simulación de cambios corporales" description="Compara parámetros visuales sin modificar las mediciones observadas de ningún expediente."/>
    <div className="enterprise-module-columns enterprise-sim-layout">
      <section className="enterprise-panel enterprise-module-main">
        <div className="enterprise-panel-title"><h2>Comparación ilustrativa</h2><span>NO PREDICTIVO</span></div>
        <div className="enterprise-sim-figures">
          <div><span>ESTADO BASE · ILUSTRATIVO</span><HumanOutline ratio={1}/><small>Referencia visual</small></div>
          <div className="enterprise-sim-arrow" aria-hidden="true">⟶</div>
          <div><span>ESCENARIO · SIMULACIÓN</span><HumanOutline ratio={ratio} heightScale={height/175}/><small>Variación artística</small></div>
        </div>
        <Limitation>La forma mostrada es una interpolación gráfica de anchura y altura, no una predicción anatómica ni una estimación de grasa o músculo. Los parámetros no generan datos clínicos.</Limitation>
      </section>
      <aside className="enterprise-panel enterprise-module-side enterprise-sim-controls">
        <h2>Parámetros hipotéticos</h2>
        <label>Peso relativo ilustrativo <output>{weightChange > 0 ? "+" : ""}{weightChange}%</output>
          <input type="range" min="-30" max="30" value={weightChange} onChange={e=>setWeightChange(Number(e.target.value))}/>
        </label>
        <label>Variación muscular artística <output>{muscleChange > 0 ? "+" : ""}{muscleChange}%</output>
          <input type="range" min="-20" max="20" value={muscleChange} onChange={e=>setMuscleChange(Number(e.target.value))}/>
        </label>
        <label>Estatura de referencia visual <output>{height} cm</output>
          <input type="range" min="145" max="205" value={height} onChange={e=>setHeight(Number(e.target.value))}/>
        </label>
        <button className="primary-button" onClick={()=>setSaved({weight:weightChange,muscle:muscleChange,height})}>Registrar comparación local</button>
        {saved && <div className="enterprise-sim-result" role="status"><strong>Escenario visual actual</strong><p>Variación de peso: {saved.weight}% · Definición: {saved.muscle}% · Estatura de referencia: {saved.height} cm.</p><small>No guardado en expedientes ni enviado al servidor.</small></div>}
        <button onClick={()=>{setWeightChange(0);setMuscleChange(0);setHeight(175);setSaved(null)}} className="secondary-button">Restablecer escenario</button>
      </aside>
    </div>
  </div>;
}

export function ReportsPage() {
  const {id,api} = useWorkspace();
  const [profileId,setProfileId] = useState("");
  const profiles=useQuery({queryKey:["profiles",id,"reports"],queryFn:()=>api.profiles("",0)});
  const measurements=useQuery({queryKey:["report-measurements",id,profileId],queryFn:()=>api.measurements(profileId),enabled:!!profileId});
  const derived=useQuery({queryKey:["report-derived",id,profileId],queryFn:()=>api.derived(profileId),enabled:!!profileId});
  const current=profiles.data?.items.find(profile=>profile.id===profileId);
  const exportCsv=()=>{
    const rows=measurements.data?.items || [];
    const head=["fecha","metrica","valor","unidad","metodo","responsable","tipo"];
    const csv=[head,...rows.map(m=>[m.measured_at,m.metric_code,String(m.value),m.unit,m.method,m.responsible,m.data_type])]
      .map(row=>row.map(value=>'"'+value.replaceAll('"','""')+'"').join(",")).join("\n");
    const url=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"}));
    const anchor=document.createElement("a");
    anchor.href=url;anchor.download="bodyvision_mediciones_ficticias.csv";anchor.click();
    URL.revokeObjectURL(url);
  };
  return <div className="enterprise-module">
    <PageTitle eyebrow="INFORMES Y TRAZABILIDAD" title="Reportes corporales" description="Vista previa y exportación de mediciones ficticias con fecha, método, procedencia y límites interpretativos."/>
    <section className="enterprise-panel enterprise-report-builder">
      <div><h2>Preparar informe</h2><label>Expediente ficticio<select value={profileId} onChange={e=>setProfileId(e.target.value)}>
        <option value="">Seleccionar expediente</option>{profiles.data?.items.map(p=><option key={p.id} value={p.id}>{p.display_name||p.display_code} · {p.display_code}</option>)}
      </select></label></div>
      <div className="enterprise-report-actions"><button disabled={!measurements.data?.items.length} onClick={exportCsv}>Exportar registros visibles (CSV)</button><button disabled={!profileId || measurements.isPending} onClick={()=>window.print()}>Imprimir vista previa</button></div>
    </section>
    <section className="enterprise-panel enterprise-report-preview">
      <div className="enterprise-panel-title"><h2>Vista previa del informe</h2><span>FICTICIO · NO MÉDICO</span></div>
      {!profileId ? <p className="enterprise-hint">Selecciona un expediente para generar una vista previa con datos existentes del servicio.</p> :
        measurements.isPending || derived.isPending ? <LoadingState/> :
        measurements.isError || derived.isError ? <p className="enterprise-hint">No se pudieron obtener todos los registros. Revisa la conexión.</p> :
        <><h3>{current?.display_name || current?.display_code || "Expediente"}</h3>
          <p className="enterprise-hint">Código: {current?.display_code} · Fecha del informe: {new Date().toLocaleDateString("es-PE")}. Fuente: registros observados y cálculos derivados de la API.</p>
          <h4>Mediciones observadas</h4>
          <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Métrica</th><th>Valor</th><th>Método</th><th>Responsable</th></tr></thead><tbody>
            {measurements.data?.items.map(m=><tr key={m.id}><td>{dateTime(m.measured_at)}</td><td>{m.metric_code}</td><td>{m.value} {m.unit}</td><td>{m.method}</td><td>{m.responsible}</td></tr>)}
          </tbody></table></div>
          <h4>Cálculos derivados</h4>
          <div className="enterprise-derived-row">{derived.data?.map(d=><div key={d.metric_code}><span>{d.label}</span><strong>{d.value===null?"Sin datos":d.value.toFixed(2)+" "+d.unit}</strong><small>{d.formula}</small></div>)}</div>
        </>}
      <Limitation>Este reporte es una vista preliminar de datos ficticios. El informe PDF certificado, firmas, control de permisos y auditoría deben implementarse en las fases posteriores.</Limitation>
    </section>
  </div>;
}
export function AdministrationPage() {
  return <div className="enterprise-module">
    <PageTitle eyebrow="GOBIERNO DE LA PLATAFORMA" title="Administración y seguridad" description="El documento exige roles, consentimiento, auditoría, retención, privacidad y controles de acceso antes de trabajar con datos reales."/>
    <div className="enterprise-admin-grid">
      {[
        ["Usuarios y roles","Administrador, especialista y usuario final. Permisos granulares por expediente.","PENDIENTE"],
        ["Consentimiento informado","Versión, propósito, fecha, revocación y bloqueo de procesamiento.","PENDIENTE"],
        ["Auditoría","Eventos de lectura, edición, consulta, exportación e incidencias de acceso.","PENDIENTE"],
        ["Privacidad y retención","Cifrado, almacenamiento privado, políticas de borrado y autorización.","PENDIENTE"],
      ].map(([title,description,status])=><article className="enterprise-panel" key={title}><span>◈</span><h2>{title}</h2><p>{description}</p><small>{status}</small></article>)}
    </div>
    <div className="enterprise-panel enterprise-admin-note"><strong>Seguridad actual</strong><p>La página publicada utiliza una demostración con datos ficticios; el selector de organización no equivale a un sistema de autenticación. Para uso real deben completarse las fases de identidad, consentimiento y control de acceso.</p><Link to="/system">Consultar estado técnico ↗</Link></div>
  </div>;
}
export function AccessPage() {
  return <div className="enterprise-access">
    <div className="enterprise-access-art"><span>BODYVISION AI</span><h1>Un espacio profesional para explorar el cuerpo.</h1><p>Mediciones, visión anatómica y trazabilidad en una plataforma web.</p><div className="enterprise-access-orbit" aria-hidden="true">✧</div></div>
    <section className="enterprise-access-card"><span className="eyebrow">ACCESO PROFESIONAL</span><h2>Identificación de usuario</h2><p>La autenticación con usuarios y roles es un requisito crítico pendiente de implementar en el backend.</p>
      <label>Correo electrónico<input type="email" placeholder="usuario@organizacion.com" disabled/></label>
      <label>Contraseña<input type="password" placeholder="••••••••" disabled/></label>
      <button disabled>Inicio de sesión aún no disponible</button>
      <p>Actualmente solo está habilitada la demostración con registros ficticios; no introduzcas credenciales personales.</p>
      <Link to="/">Entrar a la demostración →</Link>
    </section>
  </div>;
}
