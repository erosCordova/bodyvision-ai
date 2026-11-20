import { lazy, Suspense, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
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
import { privateAuthEnabled } from "../../app/providers/PrivateAuthProvider";
import { ConsentPanel } from "./ConsentPanel";
const HistoryChart = lazy(() =>
  import("../analytics/HistoryChart").then((module) => ({
    default: module.HistoryChart,
  })),
);
export function ProfileDetail() {
  const { profileId = "" } = useParams();
  const { id, api, readOnly } = useWorkspace();
  const cache = useQueryClient();
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get("tab") === "measurements" ? "measurements" : "summary");
  const [metric, setMetric] = useState("weight");
  const [period, setPeriod] = useState("90d");
  const [offset, setOffset] = useState(0);
  const [form, setForm] = useState<Measurement | "new" | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const profile = useQuery({
    queryKey: ["profile", id, profileId],
    queryFn: () => api.profile(profileId),
  });
  const catalog = useQuery({ queryKey: ["catalog", id], queryFn: api.catalog });
  const measurements = useQuery({
    queryKey: ["measurements", id, profileId, metric, offset],
    queryFn: () => api.measurements(profileId, metric, offset),
  });
  const derived = useQuery({
    queryKey: ["derived", id, profileId],
    queryFn: () => api.derived(profileId),
  });
  const series = useQuery({
    queryKey: ["series", id, profileId, metric, period],
    queryFn: () => api.series(profileId, metric, period),
  });
  const versions = useQuery({
    queryKey: ["versions", id, versionId],
    queryFn: () => api.versions(versionId!),
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
            · Organización ficticia
          </p>
          <Link className="back-link" to={`/body-3d?panel=simulacion&profile=${profileId}`}>
            Abrir simulador 3D y escenarios ficticios →
          </Link>
        </div>
        <button
          className="primary-button"
          disabled={readOnly || current.status !== "active" || !catalog.data}
          onClick={() => setForm("new")}
        >
          + Registrar medición
        </button>
      </div>
      <p className="success-notice" role="status" aria-live="polite">
        {notice}
      </p>
      <nav className="record-tabs" aria-label="Secciones del expediente">
        {[
          ["summary", "Resumen"],
          ["measurements", "Mediciones"],
          ["analytics", "Evolución"],
        ].map(([code, label]) => (
          <button
            key={code}
            aria-pressed={tab === code}
            onClick={() => setTab(code)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "summary" && (
        <>
          <div className="section-title">
            <h2>Cálculos desde mediciones observadas</h2>
            <DataTypeBadge type="DERIVADO" />
          </div>
          <p className="muted">
            Son relaciones matemáticas descriptivas; no son una evaluación
            clínica.
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
            {editing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  update.mutate({ display_name: name || null });
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
                <button className="primary-button" disabled={update.isPending}>
                  Guardar referencia
                </button>
                <button type="button" onClick={() => setEditing(false)}>
                  Cancelar
                </button>
              </form>
            ) : (
              <button
                disabled={readOnly || current.status === "archived"}
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
                onClick={() =>
                  update.mutate({
                    status:
                      current.status === "restricted" ? "active" : "restricted",
                  })
                }
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
                </select>
              </label>
            )}
          </div>
          {tab === "analytics" &&
            (series.isPending ? (
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
                <MeasurementComparison
                  key={`${metric}-${period}`}
                  rows={series.data}
                  unit={selectedMetric?.unit ?? ""}
                  profileId={profileId}
                  profileCode={current.display_code}
                  synthetic={current.synthetic}
                  metricCode={metric}
                  metricLabel={selectedMetric?.label ?? metric}
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
                            <button onClick={() => setVersionId(row.id)}>
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
      {privateAuthEnabled() && <ConsentPanel key={profileId} profileId={profileId} />}
      {form && catalog.data && (
        <MeasurementForm
          profileId={profileId}
          metrics={catalog.data}
          correction={form === "new" ? undefined : form}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
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
          onClose={() => setVersionId(null)}
        >
          {versions.isPending ? (
            <LoadingState />
          ) : versions.isError ? (
            <ErrorState
              error={versions.error}
              retry={() => void versions.refetch()}
            />
          ) : (
            <ol className="version-list">
              {versions.data.map((row, index) => (
                <li key={row.id}>
                  <DataTypeBadge type="OBSERVADO" />
                  <h3>
                    Versión {index + 1} · {row.value} {row.unit}
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
          )}
        </Modal>
      )}
    </>
  );
}
