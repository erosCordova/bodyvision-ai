import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useWorkspace } from "../../app/providers/WorkspaceProvider";
import { DataTypeBadge } from "../../components/ui/DataTypeBadge";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  dateTime,
} from "../../components/ui/States";
export function Dashboard() {
  const { id, api } = useWorkspace();
  const query = useQuery({ queryKey: ["summary", id], queryFn: api.summary });
  if (query.isPending) return <LoadingState />;
  if (query.isError)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const data = query.data;
  return (
    <>
      <div className="data-heading">
        <div>
          <p className="eyebrow">TU ESPACIO DE TRABAJO</p>
          <h1>Seguimiento con contexto.</h1>
          <p className="intro">
            Cada medición conserva su método, su fecha y su responsable.
          </p>
        </div>
        <Link className="primary-button" to="/profiles">
          Ver expedientes <span aria-hidden="true">↗</span>
        </Link>
      </div>
      <section className="kpi-grid" aria-label="Resumen de la organización">
        <article className="panel kpi">
          <span>Expedientes activos</span>
          <strong>{data.active_profiles}</strong>
          <small>Con acceso para el operador local</small>
        </article>
        <article className="panel kpi">
          <span>Mediciones en 30 días</span>
          <strong>{data.measurements_30d}</strong>
          <small>Solo versiones vigentes</small>
        </article>
        <article className="panel kpi">
          <span>Correcciones registradas</span>
          <strong>{data.corrections}</strong>
          <small>Con versiones anteriores conservadas</small>
        </article>
      </section>
      <div className="section-title">
        <h2>Últimas mediciones registradas</h2>
        <DataTypeBadge type="OBSERVADO" />
      </div>
      {data.recent_measurements.length === 0 ? (
        <EmptyState text="Aún no hay mediciones" />
      ) : (
        <div className="panel table-wrap">
          <table>
            <caption className="sr-only">
              Mediciones recientes de la organización ficticia
            </caption>
            <thead>
              <tr>
                <th>Expediente</th>
                <th>Métrica</th>
                <th>Valor</th>
                <th>Fecha de medición</th>
                <th>Responsable</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_measurements.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link to={`/profiles/${row.profile_id}`}>
                      {row.display_code}
                    </Link>
                  </td>
                  <td>{row.metric_label}</td>
                  <td>
                    {row.value} {row.unit}
                  </td>
                  <td>{dateTime(row.measured_at)}</td>
                  <td>{row.responsible}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section className="panel guidance">
        <span className="phase-label">PROCEDENCIA Y TRAZABILIDAD</span>
        <h2>Corregir conserva la historia.</h2>
        <p>
          Una corrección crea una versión nueva. Los gráficos y los cálculos
          usan la versión vigente, y el historial mantiene las anteriores.
        </p>
      </section>
    </>
  );
}
