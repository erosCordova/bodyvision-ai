import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useWorkspace } from "../../app/providers/WorkspaceProvider";
import { EmptyState, ErrorState, LoadingState, dateTime } from "../../components/ui/States";
import { ProfilePicker } from "../foundation/ModuleControls";
import { DataTypeBadge } from "../../components/ui/DataTypeBadge";
import { Icon, type IconName } from "../../components/ui/Icon";
import type { Measurement, Profile } from "../../services/api/records";

const HistoryChart = lazy(() => import("../analytics/HistoryChart").then(m => ({ default: m.HistoryChart })));
const DashboardBodyPreview = lazy(() => import("./DashboardBodyPreview").then(m => ({ default: m.DashboardBodyPreview })));

type BodyMeasurements = {
  weight: Measurement | null;
  height: Measurement | null;
  waist: Measurement | null;
  hip: Measurement | null;
  bodyFat: Measurement | null;
};

function newestMeasurement(rows: Measurement[]): Measurement | null {
  return rows.filter(row => row.is_current).slice().sort(
    (a, b) => Date.parse(b.measured_at) - Date.parse(a.measured_at),
  )[0] ?? null;
}

function measurementText(row: Measurement | null): string {
  return row ? row.value.toLocaleString("es-PE", { maximumFractionDigits: 1 }) + " " + row.unit : "Sin dato";
}

export function DashboardEvolution({
  profileId: suppliedProfileId,
  profile: suppliedProfile,
  initiallyOpen = false,
}: {
  profileId?: string;
  profile?: Profile | null;
  initiallyOpen?: boolean;
}) {
  const { id, api } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(initiallyOpen);
  const standalone = suppliedProfileId === undefined;
  const profileId = suppliedProfileId ?? searchParams.get("profile") ?? "";
  const profileQuery = useQuery({
    queryKey: ["dashboard-profile", id, profileId],
    queryFn: () => api.profile(profileId),
    enabled: standalone && open && Boolean(profileId),
  });
  const profile = suppliedProfile ?? profileQuery.data ?? null;
  const [metric, setMetric] = useState("weight");
  const [period, setPeriod] = useState("90d");
  const catalog = useQuery({
    queryKey: ["dashboard-catalog", id],
    queryFn: api.catalog,
    enabled: open && Boolean(profileId),
  });
  const options = catalog.data ?? [];
  const chosen = options.find(item => item.code === metric)
    ?? options.find(item => item.code === "weight")
    ?? options[0];
  const series = useQuery({
    queryKey: ["dashboard-series", id, profileId, chosen?.code, period],
    queryFn: () => api.series(profileId, chosen!.code, period),
    enabled: open && Boolean(profileId) && catalog.isSuccess && Boolean(chosen),
  });
  const chooseProfile = (nextId: string) => {
    if (!standalone) return;
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      if (nextId) next.set("profile", nextId);
      else next.delete("profile");
      return next;
    });
  };

  return <section className="enterprise-panel product-evolution dashboard-evolution" aria-label="Evolución corporal">
    <div className="enterprise-panel-title">
      <h2>Evolución corporal</h2>
      {profileId && <DataTypeBadge type="OBSERVADO" />}
      <button type="button" className="secondary-button dashboard-evolution-toggle" aria-expanded={open}
        onClick={() => setOpen(value => !value)}>{open ? "Ocultar gráfica" : "Explorar evolución"}</button>
    </div>
    {!open ? null :
      <div className="product-evolution-body">
        {standalone && <ProfilePicker selected={profile} selectedId={profileId} onChange={chooseProfile} />}
        {!profileId ? <EmptyState text="Selecciona un expediente para consultar sus mediciones a lo largo del tiempo." /> :
          catalog.isPending ? <LoadingState /> :
          catalog.isError ? <ErrorState error={catalog.error} retry={() => void catalog.refetch()} /> :
          !chosen ? <EmptyState text="No hay métricas disponibles." /> :
          <>
            <div className="dashboard-series-controls">
              <label>Métrica<select value={chosen.code} onChange={e => setMetric(e.target.value)}>
                {options.map(item => <option key={item.code} value={item.code}>{item.label} ({item.unit})</option>)}
              </select></label>
              <label>Periodo<select value={period} onChange={e => setPeriod(e.target.value)}>
                <option value="30d">30 días</option><option value="90d">90 días</option><option value="1a">1 año</option>
              </select></label>
            </div>
            {series.isPending ? <LoadingState /> :
              series.isError ? <ErrorState error={series.error} retry={() => void series.refetch()} /> :
              series.data.length === 0 ? <EmptyState text="Este expediente aún no tiene mediciones para el periodo seleccionado." /> :
              <Suspense fallback={<LoadingState />}><HistoryChart rows={series.data} unit={chosen.unit} /></Suspense>}
            {profile && <div className="bv-context-actions">
              <Link to={"/profiles/" + profileId + "?tab=analytics&metric=" + chosen.code}>Ver historial <Icon name="arrow-right" size={13} /></Link>
              <Link to={"/body-3d?panel=grasa&profile=" + profileId}>Abrir visor 3D <Icon name="arrow-right" size={13} /></Link>
            </div>}
          </>}
      </div>}
  </section>;
}
function DashboardComposition({
  profileId,
  measurements,
  pending,
  error,
  retry,
}: {
  profileId: string;
  measurements: BodyMeasurements | undefined;
  pending: boolean;
  error: Error | null;
  retry: () => void;
}) {
  const weight = measurements?.weight ?? null;
  const height = measurements?.height ?? null;
  const bodyFat = measurements?.bodyFat ?? null;
  const bmi = weight && height && height.value > 0
    ? weight.value / Math.pow(height.value / 100, 2)
    : null;
  const fatPercent = bodyFat ? Math.max(0, Math.min(100, bodyFat.value)) : null;
  const ringStyle = fatPercent === null ? undefined : {
    background: "conic-gradient(#26d9ec 0 " + fatPercent + "%, rgba(126, 162, 190, .18) " + fatPercent + "% 100%)",
  };

  return <section className="enterprise-panel dashboard-composition" aria-label="Composición corporal">
    <div className="enterprise-panel-title"><h2>Composición corporal</h2>{profileId && <DataTypeBadge type="OBSERVADO" />}</div>
    {!profileId ? <div className="dashboard-panel-empty"><EmptyState text="Selecciona un expediente para ver sus datos corporales." /></div> :
      pending ? <LoadingState /> :
      error ? <ErrorState error={error} retry={retry} /> :
      <div className="dashboard-composition-body">
        <div className="dashboard-composition-main">
          <div className="dashboard-composition-ring" style={ringStyle} role="img"
            aria-label={fatPercent === null ? "Sin medición de grasa corporal" : "Grasa corporal registrada: " + fatPercent + " por ciento"}>
            <div className="dashboard-composition-ring-center">
              <strong>{fatPercent === null ? "—" : fatPercent.toLocaleString("es-PE", { maximumFractionDigits: 1 }) + "%"}</strong>
              <span>grasa corporal</span>
            </div>
          </div>
          <div className="dashboard-composition-imc">
            <span>IMC calculado</span>
            <strong>{bmi === null ? "—" : bmi.toLocaleString("es-PE", { maximumFractionDigits: 1 })}</strong>
            <small>kg/m² · derivado de peso y estatura</small>
            {fatPercent === null && <small>Sin medición de grasa registrada</small>}
          </div>
        </div>
        <dl className="dashboard-composition-values">
          <div><dt>Peso</dt><dd>{measurementText(weight)}</dd></div>
          <div><dt>Estatura</dt><dd>{measurementText(height)}</dd></div>
          <div><dt>Cintura</dt><dd>{measurementText(measurements?.waist ?? null)}</dd></div>
          <div><dt>Cadera</dt><dd>{measurementText(measurements?.hip ?? null)}</dd></div>
        </dl>
        <p className="dashboard-composition-note">El porcentaje de grasa solo aparece si fue registrado en el expediente. El visor no lo estima.</p>
      </div>}
  </section>;
}

export function Dashboard() {
  const { id, api, readOnly } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const profileId = searchParams.get("profile") ?? "";
  const query = useQuery({ queryKey: ["summary", id], queryFn: api.summary });
  const profileQuery = useQuery({
    queryKey: ["dashboard-profile", id, profileId],
    queryFn: () => api.profile(profileId),
    enabled: Boolean(profileId),
  });
  const measurementsQuery = useQuery<BodyMeasurements>({
    queryKey: ["dashboard-body-measurements", id, profileId],
    queryFn: async () => {
      const [weight, height, waist, hip, bodyFat] = await Promise.all([
        api.measurements(profileId, "weight"),
        api.measurements(profileId, "height"),
        api.measurements(profileId, "waist"),
        api.measurements(profileId, "hip"),
        api.measurements(profileId, "body_fat_pct"),
      ]);
      return {
        weight: newestMeasurement(weight.items),
        height: newestMeasurement(height.items),
        waist: newestMeasurement(waist.items),
        hip: newestMeasurement(hip.items),
        bodyFat: newestMeasurement(bodyFat.items),
      };
    },
    enabled: Boolean(profileId),
  });
  const data = query.data;
  const metrics: { label: string; value: number; detail: string; icon: IconName; tone: string }[] = data ? [
    { label: "Expedientes activos", value: data.active_profiles, detail: "Registros vigentes", icon: "users", tone: "aqua" },
    { label: "Mediciones recientes", value: data.measurements_30d, detail: "Últimos 30 días", icon: "ruler", tone: "blue" },
    { label: "Correcciones", value: data.corrections, detail: "Cambios registrados", icon: "pen-line", tone: "violet" },
    ...(data.outliers_30d !== undefined
      ? [{ label: "Valores atípicos", value: data.outliers_30d, detail: "Confirmados · 30 días", icon: "activity" as IconName, tone: "amber" }]
      : data.restricted_profiles !== undefined
        ? [{ label: "Expedientes restringidos", value: data.restricted_profiles, detail: "Acceso limitado", icon: "users" as IconName, tone: "amber" }]
        : []),
  ] : [];
  const selectedProfile = profileQuery.data ?? null;
  const bodyMeasurements = measurementsQuery.data;
  const changeProfile = (nextId: string) => {
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      if (nextId) next.set("profile", nextId);
      else next.delete("profile");
      return next;
    });
  };
  const weight = bodyMeasurements?.weight ?? null;
  const height = bodyMeasurements?.height ?? null;
  const bodyContext = !profileId ? "Vista general · selecciona un expediente para adaptar el modelo."
    : profileQuery.isPending || measurementsQuery.isPending ? "Cargando los datos del expediente…"
    : measurementsQuery.isError ? "No se pudieron consultar las mediciones de este expediente."
    : weight || height ? "Representación ilustrativa ajustada con peso y estatura registrados."
    : "Sin peso ni estatura registrados; se muestra el modelo anatómico de referencia.";

  return <div className="enterprise-dashboard product-dashboard">
    <header className="enterprise-page-head product-heading">
      <div><h1>Dashboard</h1><p>Actividad, evolución y visualización corporal</p></div>
      <Link className="primary-button" to={readOnly ? "/profiles" : "/profiles?new=1"}>
        <Icon name={readOnly ? "folder" : "plus"} size={17} />{readOnly ? "Ver expedientes" : "Nuevo expediente"}
      </Link>
    </header>

    <section className="enterprise-panel dashboard-record-context" aria-label="Expediente mostrado">
      <div className="dashboard-record-summary">
        <span>EXPEDIENTE EN VISTA</span>
        <strong>{!profileId ? "Vista general" : profileQuery.isPending ? "Cargando expediente…" :
          profileQuery.isError ? "Expediente no disponible" :
          selectedProfile?.display_name || selectedProfile?.display_code || "Expediente seleccionado"}</strong>
        <small>{bodyContext}</small>
      </div>
      <div className="dashboard-record-picker">
        <ProfilePicker selected={selectedProfile} selectedId={profileId} onChange={changeProfile} />
      </div>
    </section>

    <section className="product-metrics bv-dashboard-kpis" aria-label="Indicadores del dashboard">
      {query.isPending ? <LoadingState /> : query.isError ? <ErrorState error={query.error} retry={() => void query.refetch()} /> :
        metrics.map(metric => <article key={metric.label} className="enterprise-kpi product-metric">
          <span className={"enterprise-kpi-icon " + metric.tone} aria-hidden="true"><Icon name={metric.icon} size={20} /></span>
          <p>{metric.label}</p><strong>{metric.value.toLocaleString("es-PE")}</strong><small>{metric.detail}</small>
        </article>)}
    </section>

    <div className="dashboard-main-grid">
      <section className="enterprise-panel enterprise-anatomy-promo product-hero dashboard-hero" aria-label="Exploración anatómica">
        <div className="product-hero-head">
          <div><h2>Visión corporal 3D</h2><p>Modelo anatómico interactivo</p></div>
          <span className="product-live-label">ATLAS 3D</span>
        </div>
        <Suspense fallback={<div className="enterprise-realbody-preview enterprise-realbody-loading" role="status">Cargando modelo anatómico…</div>}>
          <DashboardBodyPreview bodyWeightKg={weight?.value} statureCm={height?.value} />
        </Suspense>
        <div className="dashboard-preview-note" aria-live="polite">
          {weight && <span>Peso registrado: {measurementText(weight)}</span>}
          {height && <span>Estatura registrada: {measurementText(height)}</span>}
          {!weight && !height && <span>{profileId ? "No hay medidas antropométricas registradas." : "Vista de referencia hasta seleccionar un expediente."}</span>}
          <small>La forma visual es ilustrativa; no reconstruye ni diagnostica el cuerpo real.</small>
        </div>
        <div className="product-hero-bottom">
          <Link className="primary-button" to={profileId ? "/body-3d?profile=" + profileId : "/body-3d"}>
            Abrir visor completo <Icon name="arrow-up-right" size={16} />
          </Link>
        </div>
      </section>

      <DashboardEvolution profileId={profileId} profile={selectedProfile} initiallyOpen />
      <DashboardComposition
        profileId={profileId}
        measurements={bodyMeasurements}
        pending={measurementsQuery.isPending}
        error={measurementsQuery.isError ? measurementsQuery.error : null}
        retry={() => void measurementsQuery.refetch()}
      />
    </div>

    <section className="enterprise-panel enterprise-recent dashboard-activity" aria-label="Actividad reciente">
      <div className="enterprise-panel-title"><h2>Actividad reciente</h2><Link to="/measurements">Ver mediciones <Icon name="arrow-right" size={13} /></Link></div>
      {query.isPending ? <LoadingState /> : query.isError ? <p className="enterprise-hint">Actividad no disponible.</p> :
        data?.recent_measurements.length ? <div className="enterprise-activity-list">
          {data.recent_measurements.slice(0, 6).map(row => <Link key={row.id} to={"/profiles/" + row.profile_id + "?tab=measurements"} className="enterprise-activity-item">
            <span aria-hidden="true"><Icon name="activity" size={16} /></span>
            <div><strong>{row.metric_label} · {row.value} {row.unit}</strong><small>{row.display_code} · {row.responsible}</small></div>
            <time>{dateTime(row.measured_at)}</time>
          </Link>)}
        </div> : <EmptyState text="Aún no hay mediciones recientes." />}
    </section>
  </div>;
}
