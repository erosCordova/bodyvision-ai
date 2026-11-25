import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useWorkspace } from "../../app/providers/WorkspaceProvider";
import { EmptyState, ErrorState, LoadingState, dateTime } from "../../components/ui/States";
import { ProfilePicker } from "../foundation/ModuleControls";
import { DataTypeBadge } from "../../components/ui/DataTypeBadge";
import { Icon, type IconName } from "../../components/ui/Icon";
const HistoryChart = lazy(() => import("../analytics/HistoryChart").then(m => ({ default: m.HistoryChart })));

const DashboardBodyPreview = lazy(() => import("./DashboardBodyPreview").then(m => ({ default: m.DashboardBodyPreview })));
const shortcuts: { to: string; icon: IconName; title: string; detail: string }[] = [
  { to: "/capture", icon: "camera", title: "Captura corporal", detail: "Preparar imagen" },
  { to: "/analysis", icon: "sparkles", title: "Análisis IA", detail: "Evaluar postura" },
  { to: "/body-3d?panel=simulacion", icon: "box", title: "Simulación 3D", detail: "Peso y estatura" },
  { to: "/reports", icon: "file-text", title: "Reportes", detail: "Consultar informes" },
];

export function DashboardEvolution({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const { id, api } = useWorkspace();
  const [open, setOpen] = useState(initiallyOpen);
  const [params]=useSearchParams();
  const [profileId, setProfileId] = useState(params.get("profile")??"");
  const [metric, setMetric] = useState("body_fat_pct");
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
    {!open ? <div className="product-evolution-body"><button type="button" className="secondary-button" onClick={()=>setOpen(true)}>Explorar evolución</button></div> :
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
            <div className="bv-context-actions"><Link to={"/profiles/"+profileId+"?tab=analytics&metric=body_fat_pct"}>Historial <Icon name="arrow-right" size={13} /></Link><Link to={"/body-3d?panel=grasa&profile="+profileId}>Visor 3D <Icon name="arrow-right" size={13} /></Link></div>
          </>}
      </div>}
  </section>;
}

export function Dashboard() {
  const { id, api, readOnly } = useWorkspace();
  const query = useQuery({ queryKey: ["summary", id], queryFn: api.summary });
  const data = query.data;
  const metrics: { label: string; value: number; detail: string; icon: IconName; tone: string }[] = data ? [
    { label: "Expedientes activos", value: data.active_profiles, detail: "Registros vigentes", icon: "users", tone: "aqua" },
    { label: "Mediciones recientes", value: data.measurements_30d, detail: "Últimos 30 días", icon: "ruler", tone: "blue" },
    { label: "Correcciones", value: data.corrections, detail: "Historial de cambios", icon: "pen-line", tone: "violet" },
  ] : [];
  return (
    <div className="enterprise-dashboard product-dashboard">
      <header className="enterprise-page-head product-heading">
        <div>
          <h1>Resumen general</h1>
          <p>Seguimiento de la composición corporal</p>
        </div>
        <Link className="primary-button" to={readOnly?"/profiles":"/profiles?new=1"}><Icon name={readOnly?"folder":"plus"} size={17}/>{readOnly?"Ver expedientes":"Nuevo expediente"}</Link>
      </header>
          <section className="product-metrics bv-dashboard-kpis" aria-label="Indicadores reales de la organización ficticia">
            {query.isPending ? <LoadingState/> : query.isError ? <ErrorState error={query.error} retry={()=>void query.refetch()}/> :
              metrics.map(metric=><article key={metric.label} className="enterprise-kpi product-metric">
                <span className={"enterprise-kpi-icon "+metric.tone} aria-hidden="true"><Icon name={metric.icon} size={20} /></span>
                <p>{metric.label}</p><strong>{metric.value.toLocaleString("es-PE")}</strong><small>{metric.detail}</small>
              </article>)}
          </section>
      <div className="product-dashboard-grid">
        <section className="enterprise-panel enterprise-anatomy-promo product-hero" aria-label="Exploración anatómica">
          <div className="product-hero-head"><h2>Visión corporal 3D</h2></div>
          <Suspense fallback={<div className="enterprise-realbody-preview enterprise-realbody-loading" role="status">Cargando modelo anatómico…</div>}>
            <DashboardBodyPreview />
          </Suspense>
          <div className="product-hero-bottom"><Link className="primary-button" to="/body-3d">Abrir visor completo <Icon name="arrow-up-right" size={16} /></Link></div>
        </section>
        <div className="product-dashboard-side">

          <section className="enterprise-panel dashboard-alerts" aria-label="Alertas de seguimiento">
            <div className="enterprise-panel-title"><h2>Alertas de seguimiento</h2></div>
            {query.isPending ? <LoadingState/> : query.isError || data?.outliers_30d === undefined || data.restricted_profiles === undefined ? <p className="enterprise-hint">Alertas no disponibles.</p> :
              <div className="dashboard-alert-items">
                <Link to="/measurements"><span>Valores atípicos confirmados · 30 días</span><strong>{data.outliers_30d}</strong></Link>
                <Link to="/profiles?status=restricted"><span>Expedientes restringidos</span><strong>{data.restricted_profiles}</strong></Link>
                <small>No son alertas clínicas.</small>
              </div>}
          </section>
          <section className="enterprise-panel product-shortcuts">
            <div className="enterprise-panel-title"><h2>Accesos rápidos</h2></div>
            <div className="product-shortcut-grid">{shortcuts.map(item=><Link to={item.to} key={item.to}>
              <span aria-hidden="true"><Icon name={item.icon} size={19} /></span><div><strong>{item.title}</strong><small>{item.detail}</small></div><span aria-hidden="true"><Icon name="arrow-up-right" size={16} /></span>
            </Link>)}</div>
          </section>
          <section className="enterprise-panel enterprise-recent" aria-label="Expedientes recientes">
            <div className="enterprise-panel-title"><h2>Expedientes recientes</h2><Link to="/profiles">Ver expedientes <Icon name="arrow-right" size={13} /></Link></div>
            {query.isPending ? <LoadingState/> : query.isError || !data?.recent_profiles ? <p className="enterprise-hint">Expedientes recientes no disponibles.</p> : data.recent_profiles.length === 0 ? <EmptyState text="Aún no hay expedientes."/> :
              <div className="enterprise-activity-list">{data.recent_profiles.map(row=><Link key={row.id} to={"/profiles/"+row.id} className="enterprise-activity-item">
                <span aria-hidden="true"><Icon name="user" size={16} /></span><div><strong>{row.display_code}</strong><small>{row.status==="active"?"Activo":row.status==="restricted"?"Restringido":"Archivado"}</small></div><time>{dateTime(row.created_at)}</time>
              </Link>)}</div>}
          </section>
          <section className="enterprise-panel enterprise-recent product-recent">
            <div className="enterprise-panel-title"><h2>Actividad reciente</h2><Link to="/measurements">Ver todo <Icon name="arrow-right" size={13} /></Link></div>
            {query.isPending ? <LoadingState/> : query.isError ? <p className="enterprise-hint">Actividad no disponible.</p> : data?.recent_measurements.length ?
              <div className="enterprise-activity-list">{data.recent_measurements.slice(0,5).map(row=><Link key={row.id} to={"/profiles/"+row.profile_id+"?tab=measurements"} className="enterprise-activity-item">
                <span aria-hidden="true"><Icon name="activity" size={16} /></span><div><strong>{row.metric_label} · {row.value} {row.unit}</strong><small>{row.display_code} · {row.responsible}</small></div><time>{dateTime(row.measured_at)}</time>
              </Link>)}</div> : <EmptyState text="Aún no hay mediciones recientes."/>}
          </section>
        </div>
      </div>
      <DashboardEvolution key={id} initiallyOpen/>
    </div>
  );
}
