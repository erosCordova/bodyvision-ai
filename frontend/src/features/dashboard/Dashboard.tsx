import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useWorkspace } from "../../app/providers/WorkspaceProvider";
import { DataTypeBadge } from "../../components/ui/DataTypeBadge";
import { EmptyState, ErrorState, LoadingState, dateTime } from "../../components/ui/States";

const DashboardBodyPreview = lazy(() => import("./DashboardBodyPreview").then(m => ({ default: m.DashboardBodyPreview })));

export function Dashboard() {
  const { id, api } = useWorkspace();
  const query = useQuery({ queryKey: ["summary", id], queryFn: api.summary });
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const data = query.data;
  const series = [...data.recent_measurements]
    .filter(row => row.metric_code === "weight")
    .sort((a, b) => Date.parse(a.measured_at) - Date.parse(b.measured_at));
  const min = series.length ? Math.min(...series.map(row => row.value)) - 1 : 0;
  const max = series.length ? Math.max(...series.map(row => row.value)) + 1 : 1;
  const points = series.map((row, index) => ({
    row,
    x: 16 + (series.length === 1 ? 0.5 : index / (series.length - 1)) * 468,
    y: 150 - (row.value - min) / Math.max(max - min, .01) * 115,
  }));
  return (
    <div className="enterprise-dashboard">
      <div className="enterprise-page-head">
        <div><p className="eyebrow">PANEL DE CONTROL · DATOS AUTORIZADOS</p><h1>Dashboard general</h1>
          <p>Expedientes, registros, evolución y acceso al análisis corporal de BODYVISION AI.</p></div>
        <Link className="primary-button" to="/profiles">Abrir expedientes ↗</Link>
      </div>
      <section className="enterprise-kpis" aria-label="Indicadores reales de la organización ficticia">
        <article className="enterprise-kpi"><span className="enterprise-kpi-icon aqua">♙</span><p>Expedientes activos</p><strong>{data.active_profiles.toLocaleString("es-PE")}</strong><small>Registros vigentes</small></article>
        <article className="enterprise-kpi"><span className="enterprise-kpi-icon blue">▥</span><p>Mediciones recientes</p><strong>{data.measurements_30d.toLocaleString("es-PE")}</strong><small>Últimos 30 días</small></article>
        <article className="enterprise-kpi"><span className="enterprise-kpi-icon violet">◇</span><p>Correcciones</p><strong>{data.corrections.toLocaleString("es-PE")}</strong><small>Versiones conservadas</small></article>
        <article className="enterprise-kpi"><span className="enterprise-kpi-icon purple">✧</span><p>Análisis IA validados</p><strong>—</strong><small>Procesamiento no disponible</small></article>
      </section>
      <div className="enterprise-dashboard-grid">
        <section className="enterprise-panel enterprise-anatomy-promo" aria-label="Exploración anatómica">
          <div className="enterprise-panel-title"><h2>Exploración corporal</h2><span>ATLAS 3D</span></div>
          <Suspense fallback={<div className="enterprise-realbody-preview enterprise-realbody-loading" role="status">Preparando el modelo humano 3D…</div>}>
            <DashboardBodyPreview />
          </Suspense>
          <div className="enterprise-anatomy-cta"><strong>Visualizador anatómico interactivo</strong><p>Vista previa del modelo humano con textura realista. Accede a la visión anatómica para explorar piel, músculos, huesos y vasos.</p>
            <Link to="/body-3d">Explorar cuerpo 3D ↗</Link></div>
        </section>
        <section className="enterprise-panel enterprise-evolution">
          <div className="enterprise-panel-title"><h2>Evolución corporal</h2><DataTypeBadge type="OBSERVADO"/></div>
          <p className="enterprise-panel-hint">Registros de peso recientes de la organización ficticia, sin inferencias clínicas.</p>
          {series.length >= 2 ? (
            <div className="enterprise-trend-wrap">
              <svg viewBox="0 0 500 184" aria-label="Últimas mediciones de peso registradas" role="img" preserveAspectRatio="none">
                <g stroke="#35516e" strokeWidth=".75">{[35,75,115,155].map(y=><line key={y} x1="10" y1={y} x2="492" y2={y}/>)}</g>
                <polyline fill="none" stroke="#40d5ef" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={points.map(p=>[p.x,p.y].join(",")).join(" ")}/>
                {points.map(p=><circle key={p.row.id} cx={p.x} cy={p.y} r="4.5" fill="#78eaff" stroke="#0d2440" strokeWidth="2"/>)}
              </svg>
              <div className="enterprise-chart-dates"><span>{new Date(series[0].measured_at).toLocaleDateString("es-PE")}</span><span>{new Date(series[series.length-1].measured_at).toLocaleDateString("es-PE")}</span></div>
              <p>{series.length} mediciones de distintos expedientes. Para comparar una sola persona, abre su historial.</p>
            </div>
          ) : (
            <div className="enterprise-empty-chart"><span>⌁</span><p>Se necesitan dos mediciones de peso recientes para mostrar una tendencia descriptiva.</p><Link to="/profiles">Ver historiales →</Link></div>
          )}
          <div className="enterprise-quick-actions">
            <Link to="/capture"><span>◫</span><strong>Captura guiada</strong><small>Imágenes y consentimiento</small></Link>
            <Link to="/analysis"><span>✧</span><strong>Análisis visual</strong><small>Proceso de pose y calidad</small></Link>
          </div>
        </section>
        <section className="enterprise-panel enterprise-recent">
          <div className="enterprise-panel-title"><h2>Actividad reciente</h2><Link to="/measurements">Ver mediciones →</Link></div>
          {data.recent_measurements.length ? (
            <div className="enterprise-activity-list">{data.recent_measurements.slice(0,7).map(row=>(
              <Link key={row.id} to={"/profiles/" + row.profile_id} className="enterprise-activity-item">
                <span>▥</span><div><strong>{row.metric_label} · {row.value} {row.unit}</strong><small>{row.display_code} · {row.responsible}</small></div><time>{dateTime(row.measured_at)}</time>
              </Link>
            ))}</div>
          ) : <EmptyState text="Aún no hay mediciones recientes."/>}
        </section>
      </div>
      <div className="enterprise-dashboard-note"><strong>Transparencia de datos</strong><span>Los indicadores se consultan desde el backend. No se muestran cifras clínicas ni resultados de IA inventados.</span></div>
    </div>
  );
}
