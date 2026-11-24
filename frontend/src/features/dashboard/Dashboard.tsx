import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useWorkspace } from "../../app/providers/WorkspaceProvider";
import { EmptyState, ErrorState, LoadingState, dateTime } from "../../components/ui/States";
import { ProfilePicker } from "../foundation/ModuleControls";
import { DataTypeBadge } from "../../components/ui/DataTypeBadge";
const HistoryChart = lazy(() => import("../analytics/HistoryChart").then(m => ({ default: m.HistoryChart })));

const DashboardBodyPreview = lazy(() => import("./DashboardBodyPreview").then(m => ({ default: m.DashboardBodyPreview })));
const shortcuts=[
  {to:"/capture",symbol:"◫",title:"Captura corporal",detail:"Preparar imagen"},
  {to:"/analysis",symbol:"✧",title:"Análisis IA",detail:"Evaluar postura"},
  {to:"/simulation",symbol:"⬡",title:"Simulación 3D",detail:"Peso y estatura"},
  {to:"/reports",symbol:"▧",title:"Reportes",detail:"Consultar informes"},
];

function DashboardEvolution() {
  const { id, api } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [metric, setMetric] = useState("weight");
  const [period, setPeriod] = useState("90d");
  const profile = useQuery({
    queryKey: ["dashboard-profile", id, profileId],
    queryFn: () => api.profile(profileId),
    enabled: open && Boolean(profileId),
  });
  const catalog = useQuery({
    queryKey: ["dashboard-catalog", id],
    queryFn: api.catalog,
    enabled: open && Boolean(profileId),
  });
  const options = catalog.data ?? [];
  const chosen = options.find(item => item.code === metric) ?? options[0];
  const series = useQuery({
    queryKey: ["dashboard-series", id, profileId, chosen?.code, period],
    queryFn: () => api.series(profileId, chosen!.code, period),
    enabled: open && Boolean(profileId) && profile.isSuccess && catalog.isSuccess && Boolean(chosen),
  });
  return <section className="enterprise-panel product-evolution" aria-label="Evolución corporal">
    <div className="enterprise-panel-title"><h2>Evolución corporal</h2><DataTypeBadge type="OBSERVADO"/></div>
    {!open ? <div className="product-evolution-body"><p className="enterprise-hint">Consulta la evolución de un expediente, sin mezclar personas ni unidades.</p><button type="button" className="secondary-button" onClick={()=>setOpen(true)}>Explorar evolución</button></div> :
      <div className="product-evolution-body">
        <ProfilePicker selected={profile.data ?? null} selectedId={profileId} onChange={setProfileId}/>
        {!profileId ? <EmptyState text="Selecciona un expediente para consultar su evolución."/> :
          profile.isPending || catalog.isPending ? <LoadingState/> :
          profile.isError ? <ErrorState error={profile.error} retry={()=>void profile.refetch()}/> :
          catalog.isError ? <ErrorState error={catalog.error} retry={()=>void catalog.refetch()}/> :
          !chosen ? <EmptyState text="No hay métricas disponibles."/> :
          <>
            <div className="dashboard-series-controls">
              <label>Métrica<select value={chosen.code} onChange={e=>setMetric(e.target.value)}>{options.map(item=><option key={item.code} value={item.code}>{item.label} ({item.unit})</option>)}</select></label>
              <label>Periodo<select value={period} onChange={e=>setPeriod(e.target.value)}><option value="30d">30 días</option><option value="90d">90 días</option><option value="1a">1 año</option></select></label>
            </div>
            {series.isPending ? <LoadingState/> : series.isError ? <ErrorState error={series.error} retry={()=>void series.refetch()}/> : <Suspense fallback={<LoadingState/>}><HistoryChart rows={series.data} unit={chosen.unit}/></Suspense>}
            <Link to={"/profiles/"+profileId+"?tab=analytics"}>Ver historial y fuentes →</Link>
          </>}
      </div>}
  </section>;
}

export function Dashboard() {
  const { id, api } = useWorkspace();
  const query = useQuery({ queryKey: ["summary", id], queryFn: api.summary });
  const data = query.data;
  const metrics = data ? [
    {label:"Expedientes activos",value:data.active_profiles,detail:"Registros vigentes",icon:"♙",tone:"aqua"},
    {label:"Mediciones recientes",value:data.measurements_30d,detail:"Últimos 30 días",icon:"▥",tone:"blue"},
    {label:"Correcciones",value:data.corrections,detail:"Historial de cambios",icon:"◇",tone:"violet"},
  ] : [];
  return (
    <div className="enterprise-dashboard product-dashboard">
      <header className="enterprise-page-head product-heading">
        <div><p className="eyebrow">TU ESPACIO DE TRABAJO</p><h1>Dashboard general</h1><p>Exploración anatómica y seguimiento corporal.</p></div>
        <Link className="primary-button" to="/profiles">Ver expedientes <span aria-hidden="true">↗</span></Link>
      </header>
      <div className="product-dashboard-grid">
        <section className="enterprise-panel enterprise-anatomy-promo product-hero" aria-label="Exploración anatómica">
          <div className="product-hero-head"><h2>Visión corporal 3D</h2></div>
          <Suspense fallback={<div className="enterprise-realbody-preview enterprise-realbody-loading" role="status">Cargando modelo anatómico…</div>}>
            <DashboardBodyPreview />
          </Suspense>
          <div className="product-hero-bottom"><Link className="primary-button" to="/body-3d">Abrir visor completo ↗</Link></div>
        </section>
        <div className="product-dashboard-side">
          <section className="product-metrics" aria-label="Indicadores reales de la organización ficticia">
            {query.isPending ? <LoadingState/> : query.isError ? <ErrorState error={query.error} retry={()=>void query.refetch()}/> :
              metrics.map(metric=><article key={metric.label} className="enterprise-kpi product-metric">
                <span className={"enterprise-kpi-icon "+metric.tone} aria-hidden="true">{metric.icon}</span>
                <p>{metric.label}</p><strong>{metric.value.toLocaleString("es-PE")}</strong><small>{metric.detail}</small>
              </article>)}
          </section>
          <section className="enterprise-panel dashboard-alerts" aria-label="Alertas de seguimiento">
            <div className="enterprise-panel-title"><h2>Alertas de seguimiento</h2></div>
            {query.isPending ? <LoadingState/> : query.isError || data?.outliers_30d === undefined || data.restricted_profiles === undefined ? <p className="enterprise-hint">Alertas no disponibles.</p> :
              <div className="dashboard-alert-items">
                <Link to="/measurements"><span>Valores atípicos confirmados · 30 días</span><strong>{data.outliers_30d}</strong></Link>
                <Link to="/profiles"><span>Expedientes restringidos</span><strong>{data.restricted_profiles}</strong></Link>
                <small>Indicadores de seguimiento; no son alertas clínicas.</small>
              </div>}
          </section>
          <section className="enterprise-panel product-shortcuts">
            <div className="enterprise-panel-title"><h2>Accesos rápidos</h2></div>
            <div className="product-shortcut-grid">{shortcuts.map(item=><Link to={item.to} key={item.to}>
              <span aria-hidden="true">{item.symbol}</span><div><strong>{item.title}</strong><small>{item.detail}</small></div><span aria-hidden="true">↗</span>
            </Link>)}</div>
          </section>
          <section className="enterprise-panel enterprise-recent product-recent">
            <div className="enterprise-panel-title"><h2>Actividad reciente</h2><Link to="/measurements">Ver todo →</Link></div>
            {query.isPending ? <LoadingState/> : query.isError ? <p className="enterprise-hint">Actividad no disponible.</p> : data?.recent_measurements.length ?
              <div className="enterprise-activity-list">{data.recent_measurements.slice(0,5).map(row=><Link key={row.id} to={"/profiles/"+row.profile_id+"?tab=measurements"} className="enterprise-activity-item">
                <span aria-hidden="true">▥</span><div><strong>{row.metric_label} · {row.value} {row.unit}</strong><small>{row.display_code} · {row.responsible}</small></div><time>{dateTime(row.measured_at)}</time>
              </Link>)}</div> : <EmptyState text="Aún no hay mediciones recientes."/>}
          </section>
        </div>
      </div>
      <DashboardEvolution key={id}/>
    </div>
  );
}
