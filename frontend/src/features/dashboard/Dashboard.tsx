import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useWorkspace } from "../../app/providers/WorkspaceProvider";
import { EmptyState, ErrorState, LoadingState, dateTime } from "../../components/ui/States";

const DashboardBodyPreview = lazy(() => import("./DashboardBodyPreview").then(m => ({ default: m.DashboardBodyPreview })));
const shortcuts=[
  {to:"/capture",symbol:"◫",title:"Captura corporal",detail:"Preparar imagen"},
  {to:"/analysis",symbol:"✧",title:"Análisis IA",detail:"Evaluar postura"},
  {to:"/simulation",symbol:"⬡",title:"Simulación 3D",detail:"Peso y estatura"},
  {to:"/reports",symbol:"▧",title:"Reportes",detail:"Consultar informes"},
];

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
          <div className="product-hero-head"><div><p className="eyebrow">ANATOMÍA INTERACTIVA</p><h2>Visión corporal 3D</h2></div><span className="product-live-label">6 capas</span></div>
          <Suspense fallback={<div className="enterprise-realbody-preview enterprise-realbody-loading" role="status">Cargando modelo anatómico…</div>}>
            <DashboardBodyPreview />
          </Suspense>
          <div className="product-hero-bottom"><span>Atlas anatómico de referencia</span><Link className="primary-button" to="/body-3d">Abrir visor completo ↗</Link></div>
        </section>
        <div className="product-dashboard-side">
          <section className="product-metrics" aria-label="Indicadores reales de la organización ficticia">
            {query.isPending ? <LoadingState/> : query.isError ? <ErrorState error={query.error} retry={()=>void query.refetch()}/> :
              metrics.map(metric=><article key={metric.label} className="enterprise-kpi product-metric">
                <span className={"enterprise-kpi-icon "+metric.tone} aria-hidden="true">{metric.icon}</span>
                <p>{metric.label}</p><strong>{metric.value.toLocaleString("es-PE")}</strong><small>{metric.detail}</small>
              </article>)}
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
    </div>
  );
}
