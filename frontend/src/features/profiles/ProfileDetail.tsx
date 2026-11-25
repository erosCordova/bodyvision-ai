import { lazy, Suspense, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Icon, type IconName } from "../../components/ui/Icon";
import { useWorkspace } from "../../app/providers/WorkspaceProvider";
import { type Measurement } from "../../services/api/records";
import { DataTypeBadge } from "../../components/ui/DataTypeBadge";
import {
  EmptyState,
  ErrorState,
  InlineError,
  LoadingState,
  dateTime,
} from "../../components/ui/States";
import { Modal } from "../../components/ui/Modal";
import { MeasurementForm } from "../measurements/MeasurementForm";
import { MeasurementComparison } from "../analytics/MeasurementComparison";
import { LongitudinalSummary } from "../analytics/LongitudinalSummary";
import { validExportRange } from "../analytics/serverLongitudinalExport";
import { privateAuthEnabled, sandboxAuthEnabled } from "../../app/providers/PrivateAuthProvider";
import { SandboxCaptureLibrary } from "../capture/SandboxCaptureLibrary";
import { PoseSummaryArchive } from "../capture/PoseSummaryArchive";
import { ConsentPanel } from "./ConsentPanel";
const HistoryChart = lazy(() =>
  import("../analytics/HistoryChart").then((module) => ({
    default: module.HistoryChart,
  })),
);
const HistoricalBodyComparison=lazy(()=>import("../viewer/HistoricalBodyComparison").then(m=>({default:m.HistoricalBodyComparison})));
export function ProfileDetail() {
  const { profileId = "" } = useParams();
  const { id, api, readOnly } = useWorkspace();
  const cache = useQueryClient();
  const [params,setParams]=useSearchParams();
  const requested=params.get("tab");
  const tab=requested==="measurements"||requested==="analytics"||(requested==="images"&&sandboxAuthEnabled())||(requested==="pose"&&privateAuthEnabled())?requested:"summary";
  const setTab=(next:string)=>setParams(previous=>{const result=new URLSearchParams(previous);if(next==="summary")result.delete("tab");else result.set("tab",next);return result;},{replace:true});
  const [metric, setMetric] = useState(()=>params.get("metric")==="body_fat_pct"?"body_fat_pct":"weight");
  const [period, setPeriod] = useState("90d");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const customRange = { start_date: startDate, end_date: endDate };
  const periodReady = period !== "custom" || validExportRange(customRange);
  const periodKey = period === "custom" ? `custom-${startDate}-${endDate}` : period;
  const [offset, setOffset] = useState(0);
  const [form, setForm] = useState<Measurement | "new" | null>(null);
  const [formMetric,setFormMetric]=useState<string|undefined>(undefined);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [versionOffset, setVersionOffset] = useState(0);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const profile = useQuery({
    queryKey: ["profile", id, profileId],
    queryFn: () => api.profile(profileId),
  });
  const catalog = useQuery({ queryKey: ["catalog", id], queryFn: api.catalog });
  const w=useQuery({queryKey:["measurements",id,profileId,"weight",0],queryFn:()=>api.measurements(profileId,"weight",0),enabled:profile.isSuccess&&tab==="summary"});
  const h=useQuery({queryKey:["measurements",id,profileId,"height",0],queryFn:()=>api.measurements(profileId,"height",0),enabled:profile.isSuccess&&tab==="summary"});
  const f=useQuery({queryKey:["measurements",id,profileId,"body_fat_pct",0],queryFn:()=>api.measurements(profileId,"body_fat_pct",0),enabled:profile.isSuccess&&tab==="summary"});
  const latest=(rows:Measurement[]|undefined,code:string,unit:string)=>rows?.filter(r=>r.profile_id===profileId&&r.metric_code===code&&r.unit===unit&&r.is_current&&(code!=="body_fat_pct"||(r.method==="device"&&!!r.instrument?.trim()))).sort((a,b)=>Date.parse(b.measured_at)-Date.parse(a.measured_at))[0];
  const measures=[{code:"weight",label:"Peso",unit:"kg",row:latest(w.data?.items,"weight","kg"),query:w},{code:"height",label:"Estatura",unit:"cm",row:latest(h.data?.items,"height","cm"),query:h},{code:"body_fat_pct",label:"Grasa corporal",unit:"%",row:latest(f.data?.items,"body_fat_pct","%"),query:f}];
  const measurements = useQuery({
    queryKey: ["measurements", id, profileId, metric, offset],
    queryFn: () => api.measurements(profileId, metric, offset),
    enabled: profile.isSuccess && (tab === "measurements" || tab === "analytics"),
  });
  const derived = useQuery({
    queryKey: ["derived", id, profileId],
    queryFn: () => api.derived(profileId),
    enabled: profile.isSuccess && tab === "summary",
  });
  const series = useQuery({
    queryKey: ["series", id, profileId, metric, periodKey],
    queryFn: () => period === "custom"
      ? api.series(profileId, metric, period, customRange)
      : api.series(profileId, metric, period),
    enabled: profile.isSuccess && tab === "analytics" && periodReady,
  });
  const versions = useQuery({
    queryKey: ["versions", id, versionId, versionOffset],
    queryFn: () => api.versionsPage(versionId!, versionOffset),
    enabled: !!versionId,
  });
  const update = useMutation({
    mutationFn: (body: unknown) => api.updateProfile(profileId, body),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["profile", id, profileId] });
      await cache.invalidateQueries({ queryKey: ["profiles", id] });
      await cache.invalidateQueries({ queryKey: ["summary", id] });
      setEditing(false);
      setNotice("Expediente actualizado.");
    },
  });
  const archive = useMutation({
    mutationFn: () => api.archive(profileId),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["profile", id, profileId] });
      await cache.invalidateQueries({ queryKey: ["profiles", id] });
      await cache.invalidateQueries({ queryKey: ["summary", id] });
      setNotice("Expediente archivado. Su historial se conserva.");
    },
  });
  if (profile.isPending) return <LoadingState />;
  if (profile.isError)
    return (
      <ErrorState error={profile.error} retry={() => void profile.refetch()} />
    );
  const current = profile.data;
  const selectedMetric = catalog.data?.find((m) => m.code === metric);
  return (
    <>
      <Link className="back-link" to="/profiles">
        ← Expedientes
      </Link>
      <div className="data-heading">
        <div>
          <p className="eyebrow">
            {current.display_code} · EXPEDIENTE FICTICIO
          </p>
          <h1>{current.display_name || current.display_code}</h1>
          <p className="intro">
            Año de nacimiento: {current.birth_year} ·{" "}
            {current.status === "active"
              ? "Activo"
              : current.status === "restricted"
                ? "Restringido"
                : "Archivado"}{" "}
            
          </p>

        </div>
        <button
          className="primary-button"
          disabled={readOnly || current.status !== "active" || !catalog.data}
          onClick={() => {setFormMetric(undefined);setForm("new");}}
        >
          + Registrar medición
        </button>
      </div>
      {notice&&<p className="success-notice" role="status" aria-live="polite">{notice}</p>}
      <nav className="record-tabs bv-evaluation-tabs" aria-label="Secciones del expediente">
        {([
          ["summary","Resumen","home"],["measurements","Mediciones","ruler"],
          ...(sandboxAuthEnabled()?[["images","Imágenes","camera"]]:[]),
          ["analysis","Análisis IA","sparkles"],["viewer","Visor 3D","box"],["analytics","Evolución","pulse"],["simulation","Simulación","layers"],["reports","Reportes","file-text"],
          ...(privateAuthEnabled()?[["pose","Resultados de pose","scan"]]:[]),
        ] as [string,string,IconName][]).map(([code,label,icon])=>{
          const path=code==="analysis"?"/analysis?profile="+profileId:code==="viewer"?"/body-3d?panel=grasa&profile="+profileId:code==="simulation"?"/body-3d?panel=simulacion&profile="+profileId:code==="reports"?"/reports?profile="+profileId:null;
          return path?<Link key={code} to={path}><Icon name={icon} size={16}/>{label}</Link>:<button key={code} type="button" aria-pressed={tab===code} onClick={()=>setTab(code)}><Icon name={icon} size={16}/>{label}</button>;
        })}
      </nav>

      {tab === "pose" && privateAuthEnabled() && <PoseSummaryArchive key={profileId}
        fixedProfileId={profileId} summary={null} runSerial={0} />}
      {tab === "images" && sandboxAuthEnabled() && <SandboxCaptureLibrary key={profileId} fixedProfileId={profileId} allowUpload={current.status==="active"} />}
      {tab === "summary" && (
        <>
          <div className="bv-evaluation-summary">
            <div className="bv-evaluation-metrics">{measures.map(m=><article key={m.code} className="panel bv-measure-card"><div><span>{m.label}</span><Icon name={m.code==="weight"?"activity":m.code==="height"?"ruler":"pulse"} size={19}/></div><strong>{m.query.isPending?"…":m.query.isError?"—":m.row?.value.toLocaleString("es-PE",{maximumFractionDigits:2})??"—"} <small>{m.unit}</small></strong><span>{m.row?dateTime(m.row.measured_at):m.query.isError?"No disponible":"Sin registro"}</span>{m.query.isError?<button type="button" onClick={()=>void m.query.refetch()}>Reintentar</button>:!readOnly&&current.status==="active"&&catalog.data?.some(c=>c.code===m.code)&&<button type="button" onClick={()=>{setFormMetric(m.code);setForm("new");}}>+ Registrar</button>}</article>)}</div>
            <section className="panel bv-quick-evaluation"><h2>Acciones rápidas</h2><div className="bv-evaluation-action-grid">
              <button type="button" disabled={readOnly||current.status!=="active"||!catalog.data} onClick={()=>{setFormMetric(undefined);setForm("new");}}><Icon name="ruler" size={21}/><span>Registrar medición</span><Icon name="chevron-right" size={15}/></button>
              <Link to={sandboxAuthEnabled()?"/profiles/"+profileId+"?tab=images":"/capture?profile="+profileId}><Icon name="camera" size={21}/><span>Añadir imagen</span><Icon name="chevron-right" size={15}/></Link>
              <Link to={"/body-3d?panel=grasa&profile="+profileId}><Icon name="box" size={21}/><span>Ver cuerpo 3D</span><Icon name="chevron-right" size={15}/></Link>
              <Link to={"/profiles/"+profileId+"?tab=analytics&metric=body_fat_pct"}><Icon name="pulse" size={21}/><span>Ver evolución</span><Icon name="chevron-right" size={15}/></Link>
            </div></section>
          </div>
          <div className="section-title">
            <h2>Composición corporal</h2>
            <DataTypeBadge type="DERIVADO" />
          </div>
          <p className="muted">
            Valores calculados; no constituyen diagnóstico.
          </p>
          {derived.isPending ? (
            <LoadingState />
          ) : derived.isError ? (
            <ErrorState
              error={derived.error}
              retry={() => void derived.refetch()}
            />
          ) : (
            <div className="derived-grid">
              {derived.data.map((d) => (
                <article className="panel derived-card" key={d.metric_code}>
                  <span>{d.label}</span>
                  <strong>
                    {d.value === null
                      ? "Sin datos"
                      : d.value.toLocaleString("es-PE", {
                          maximumFractionDigits: 3,
                        })}
                    <small>{d.value !== null && d.unit}</small>
                  </strong>
                  {d.reason && <p className="muted">{d.reason}</p>}
                  <details>
                    <summary>Fórmula y fuentes</summary>
                    <p>{d.formula}</p>
                    <p>Calculado al {dateTime(d.as_of)}</p>
                    <small>
                      Mediciones:{" "}
                      {d.source_measurement_ids.length
                        ? d.source_measurement_ids.join(", ")
                        : "referencias incompletas"}
                    </small>
                  </details>
                </article>
              ))}
            </div>
          )}
          <section className="panel form-panel">
            <h2>Datos y estado del expediente</h2>
            <dl className="profile-metadata"><div><dt>Código</dt><dd>{current.display_code}</dd></div><div><dt>Registrado</dt><dd>{dateTime(current.created_at)}</dd></div><div><dt>Tipo de registro</dt><dd>Ficticio</dd></div></dl>
            {current.status === "restricted" && <p role="status">
              Expediente restringido: las mediciones y la referencia son de solo lectura.
              Reactiva el registro para volver a realizar cambios autorizados.
            </p>}
            {editing && current.status === "active" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!readOnly) update.mutate({ display_name: name.trim() || null });
                }}
              >
                <label>
                  Nombre de referencia
                  <input
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <button className="primary-button" disabled={readOnly || update.isPending}>
                  Guardar referencia
                </button>
                <button type="button" onClick={() => setEditing(false)}>
                  Cancelar
                </button>
              </form>
            ) : (
              <button
                disabled={readOnly || current.status !== "active" || update.isPending}
                onClick={() => {
                  setName(current.display_name ?? "");
                  setEditing(true);
                }}
              >
                Editar referencia
              </button>
            )}
            <div className="form-actions">
              <button
                disabled={
                  readOnly || current.status === "archived" || update.isPending
                }
                onClick={() => {
                  const reactivate = current.status === "restricted";
                  if (window.confirm(reactivate
                    ? "¿Reactivar este expediente ficticio? Se permitirán nuevas mediciones autorizadas."
                    : "¿Restringir este expediente ficticio? Su historial y referencia quedarán en modo de solo lectura.")) {
                    setEditing(false);
                    update.mutate({ status: reactivate ? "active" : "restricted" });
                  }
                }}
              >
                {current.status === "restricted"
                  ? "Habilitar registro"
                  : "Restringir registro"}
              </button>
              <button
                disabled={
                  readOnly || current.status !== "active" || archive.isPending
                }
                onClick={() => {
                  if (
                    window.confirm(
                      "¿Archivar este expediente ficticio? Su historial quedará en modo de solo lectura.",
                    )
                  )
                    archive.mutate();
                }}
              >
                Archivar expediente
              </button>
            </div>
            {(update.isError || archive.isError) && (
              <InlineError error={update.error ?? archive.error} />
            )}
          </section>
        </>
      )}
      {tab==="analytics"&&<Suspense fallback={<LoadingState/>}><HistoricalBodyComparison profileId={profileId}/></Suspense>}
      {(tab === "measurements" || tab === "analytics") && (
        <>
          <div className="record-filters">
            <label>
              Métrica del historial
              <select
                value={metric}
                onChange={(e) => {
                  setMetric(e.target.value);
                  setOffset(0);
                }}
              >
                {catalog.data?.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.label} ({m.unit})
                  </option>
                ))}
              </select>
            </label>
            {tab === "analytics" && (
              <label>
                Periodo
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                >
                  <option value="30d">30 días</option>
                  <option value="90d">90 días</option>
                  <option value="1a">1 año</option>
                  <option value="all">Todo</option>
                  <option value="custom">Personalizado</option>
                </select>
              </label>
            )}
            {tab === "analytics" && period === "custom" && <>
              <label>Fecha inicial de evolución
                <input type="date" value={startDate}
                  onChange={event => setStartDate(event.currentTarget.value)} />
              </label>
              <label>Fecha final de evolución
                <input type="date" value={endDate}
                  onChange={event => setEndDate(event.currentTarget.value)} />
              </label>
            </>}
          </div>
          {tab === "analytics" &&
            (!periodReady ? (
              <p role="status">Selecciona un intervalo válido de fechas (hora de Lima).</p>
            ) : series.isPending ? (
              <LoadingState />
            ) : series.isError ? (
              <ErrorState
                error={series.error}
                retry={() => void series.refetch()}
              />
            ) : (
              <Suspense fallback={<LoadingState />}>
                <HistoryChart
                  rows={series.data}
                  unit={selectedMetric?.unit ?? ""}
                />
                <LongitudinalSummary
                  key={periodKey}
                  rows={series.data}
                  profileId={profileId}
                  metricCode={metric}
                  unit={selectedMetric?.unit ?? ""}
                  period={period as "30d" | "90d" | "1a" | "all" | "custom"}
                  selectedRange={period === "custom" ? customRange : undefined}
                  exportReport={privateAuthEnabled() && current.synthetic
                    ? (range) => api.longitudinalReport(profileId, metric,
                        period === "custom" ? "all" : period as "30d" | "90d" | "1a" | "all",
                        range ?? (period === "custom" ? customRange : undefined))
                    : undefined}
                />
                <MeasurementComparison
                  key={`${metric}-${periodKey}`}
                  rows={series.data}
                  unit={selectedMetric?.unit ?? ""}
                  profileId={profileId}
                  profileCode={current.display_code}
                  synthetic={current.synthetic}
                  metricCode={metric}
                  metricLabel={selectedMetric?.label ?? metric}
                  exportReport={privateAuthEnabled()
                    ? (initial, final) => api.comparisonReport(profileId, initial, final)
                    : undefined}
                />
              </Suspense>
            ))}
          <div className="section-title">
            <h2>Historial vigente · {selectedMetric?.label}</h2>
            <DataTypeBadge type="OBSERVADO" />
          </div>
          {measurements.isPending ? (
            <LoadingState />
          ) : measurements.isError ? (
            <ErrorState
              error={measurements.error}
              retry={() => void measurements.refetch()}
            />
          ) : (
            <>
              {!measurements.data.items.length ? (
                <EmptyState text="Aún no hay mediciones de esta métrica" />
              ) : (
                <div className="panel table-wrap">
                  <table>
                    <caption className="sr-only">
                      Mediciones observadas vigentes de {selectedMetric?.label}
                    </caption>
                    <thead>
                      <tr>
                        <th>Valor</th>
                        <th>Fecha (Lima)</th>
                        <th>Método / responsable</th>
                        <th>Procedencia</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {measurements.data.items.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <strong>
                              {row.value} {row.unit}
                            </strong>
                            {row.outlier_confirmed && (
                              <span className="outlier-label">
                                ⚑ Atípico confirmado
                              </span>
                            )}
                          </td>
                          <td>{dateTime(row.measured_at)}</td>
                          <td>
                            {row.method === "device" ? "Dispositivo" : "Manual"}
                            {row.instrument && <small>{row.instrument}</small>}
                            <small>{row.responsible}</small>
                          </td>
                          <td>
                            <DataTypeBadge type="OBSERVADO" />
                            {row.supersedes_id && (
                              <small>Versión corregida</small>
                            )}
                          </td>
                          <td>
                            <button onClick={() => { setVersionOffset(0); setVersionId(row.id); }}>
                              Ver versiones
                            </button>
                            <button
                              disabled={readOnly || current.status !== "active"}
                              onClick={() => setForm(row)}
                            >
                              Corregir
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="pagination">
                <span>{measurements.data.total} mediciones vigentes</span>
                <button
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 20))}
                >
                  Anterior
                </button>
                <button
                  disabled={offset + 20 >= measurements.data.total}
                  onClick={() => setOffset(offset + 20)}
                >
                  Siguiente
                </button>
              </div>
            </>
          )}
        </>
      )}
      {privateAuthEnabled() && !sandboxAuthEnabled() && <details className="panel bv-secondary-details"><summary>Consentimiento del expediente</summary><ConsentPanel key={profileId} profileId={profileId} /></details>}
      {form && catalog.data && (
        <MeasurementForm
          profileId={profileId}
          metrics={catalog.data}
          correction={form === "new" ? undefined : form}
          initialMetricCode={form==="new"?formMetric:undefined}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            if(formMetric)setMetric(formMetric);
            setFormMetric(undefined);
            setTab("measurements");
            setNotice(
              "Medición guardada. El historial y los cálculos se han actualizado.",
            );
          }}
        />
      )}
      {versionId && (
        <Modal
          title="Versiones de la medición"
          onClose={() => { setVersionId(null); setVersionOffset(0); }}
        >
          {versions.isPending ? (
            <LoadingState />
          ) : versions.isError ? (
            <ErrorState
              error={versions.error}
              retry={() => void versions.refetch()}
            />
          ) : (
            <div>
              <p role="status">Historial de correcciones: {versions.data.total} versiones.</p>
              <ol className="version-list" start={versionOffset + 1}>
                {versions.data.items.map((row, index) => (
                <li key={row.id}>
                  <DataTypeBadge type="OBSERVADO" />
                  <h3>
                    Versión {versionOffset + index + 1} · {row.value} {row.unit}
                  </h3>
                  <p>
                    {row.is_current ? "Vigente" : "Sustituida"} ·{" "}
                    {dateTime(row.measured_at)}
                  </p>
                  <p>{row.correction_reason ?? "Registro original"}</p>
                  <small>
                    {row.responsible} ·{" "}
                    {row.method === "manual" ? "Manual" : "Dispositivo"}
                  </small>
                </li>
              ))}
              </ol>
              {versions.data.total > versions.data.limit && <nav
                aria-label="Páginas de versiones de la medición"
                className="enterprise-pagination">
                <button type="button" disabled={versionOffset === 0}
                  onClick={() => setVersionOffset(v => Math.max(0, v - 20))}>
                  Versiones anteriores
                </button>
                <span>{versionOffset + 1}–{Math.min(versionOffset + 20, versions.data.total)}
                  de {versions.data.total}</span>
                <button type="button"
                  disabled={versionOffset + 20 >= versions.data.total}
                  onClick={() => setVersionOffset(v => v + 20)}>
                  Más versiones
                </button>
              </nav>}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
