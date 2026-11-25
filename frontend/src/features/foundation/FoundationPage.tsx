import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ApiError,
  api,
  type LiveStatus,
  type ReadyStatus,
} from "../../services/api/client";
import { Icon } from "../../components/ui/Icon";
import { Logo } from "../../components/ui/Logo";

function ServiceCheck({
  name,
  kind,
}: {
  name: string;
  kind: "live" | "ready";
}) {
  const query = useQuery<LiveStatus | ReadyStatus>({
    queryKey: ["health", kind],
    queryFn: kind === "live" ? api.live : api.ready,
  });
  return (
    <article className="service-card" aria-label={name}>
      <div className="card-heading">
        <span className="service-icon" aria-hidden="true">
          <Icon name={kind === "live" ? "activity" : "database"} size={19} />
        </span>
        <h3>{name}</h3>
      </div>
      <div aria-live="polite" aria-busy={query.isFetching}>
        {query.isPending && <p className="muted">Consultando el servicio…</p>}
        {query.isError && (
          <div role="alert">
            <p className="status error">! No disponible</p>
            <p className="muted">
              Comprueba que el entorno local esté iniciado y vuelve a consultar.
            </p>
            {query.error instanceof ApiError && (
              <p className="reference">
                Referencia: {query.error.correlationId}
              </p>
            )}
          </div>
        )}
        {query.isSuccess && query.data && (
          <>
            <p className="status success">
              ✓{" "}
              {kind === "live" ? "API en ejecución" : "Base de datos conectada"}
            </p>
            <p className="muted">
              Verificado el{" "}
              {new Intl.DateTimeFormat("es-PE", {
                timeZone: "America/Lima",
                dateStyle: "medium",
                timeStyle: "medium",
              }).format(new Date(query.data.checked_at))}{" "}
              · Lima
            </p>
            <p className="reference">
              {"schema_revision" in query.data
                ? `Esquema: ${query.data.schema_revision}`
                : `Versión: ${query.data.version}`}
            </p>
          </>
        )}
      </div>
      <button
        className="secondary-button"
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        {query.isFetching ? "Consultando…" : "Volver a consultar"}
      </button>
    </article>
  );
}

export function FoundationPage() {
  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        Saltar al contenido
      </a>
      <aside className="sidebar" aria-label="Navegación principal">
        <Link className="brand" to="/" aria-label="BODYVISION AI — Inicio">
          <span className="brand-mark" aria-hidden="true">
            <Logo size={30} />
          </span>
          <span>
            BODYVISION <strong>AI</strong>
            <small>Registro y visualización</small>
          </span>
        </Link>
        <p className="nav-label">ESPACIO DE TRABAJO</p>
        <Link className="nav-item active" to="/" aria-current="page">
          <span aria-hidden="true"><Icon name="scan" size={17} /></span> Estado del entorno
        </Link>
        <div className="sidebar-note">
          <span className="phase-label">FASE 2 / NÚCLEO DE DATOS</span>
          <p>Base técnica</p>
          <small>
            Los expedientes ficticios y las mediciones ya están disponibles en
            el espacio de trabajo.
          </small>
        </div>
        <div className="sidebar-bottom">
          <span className="local-dot" aria-hidden="true" /> Entorno de prueba ·
          es-PE
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>Plataforma de seguimiento corporal</span>
          <span className="local-pill">ENTORNO DE PRUEBA</span>
        </header>
        <main id="main-content">
          <div className="breadcrumb">
            BODYVISION AI <span aria-hidden="true">/</span> Fundación
          </div>
          <div className="page-title">
            <div>
              <p className="eyebrow">EL PRIMER PASO</p>
              <h1>Todo empieza con una base sólida.</h1>
              <p className="intro">
                Verifica la conexión de los servicios antes de continuar con el
                registro y seguimiento corporal.
              </p>
            </div>
            <span className="version-label">v0.3.0</span>
          </div>
          <section className="notice" aria-label="Alcance de esta entrega">
            <span className="notice-icon" aria-hidden="true">
              <Icon name="info" size={13} />
            </span>
            <div>
              <h2>Entorno técnico de desarrollo</h2>
              <p>
                Esta fase no recoge datos de personas. La identidad, los
                permisos y el consentimiento se incorporarán antes de habilitar
                el uso con datos reales.
              </p>
            </div>
          </section>
          <section aria-labelledby="services-title">
            <div className="section-title">
              <h2 id="services-title">Conexión de servicios</h2>
              <span>Consultas a los servicios</span>
            </div>
            <div className="services">
              <ServiceCheck name="Servicio de aplicación" kind="live" />
              <ServiceCheck name="Persistencia y esquema" kind="ready" />
            </div>
          </section>
          <section className="empty-panel" aria-labelledby="records-title">
            <div className="empty-icon" aria-hidden="true">
              <Icon name="inbox" size={36} strokeWidth={1.3} />
            </div>
            <div>
              <h2 id="records-title">El espacio de trabajo está disponible</h2>
              <p>
                Los expedientes y las mediciones utilizan únicamente datos
                ficticios. Abre el espacio de trabajo para registrarlos.
              </p>
              <Link className="secondary-button" to="/">
                Abrir espacio de trabajo
              </Link>
            </div>
          </section>
          <section className="principles" aria-label="Principios del producto">
            <article>
              <span>01</span>
              <h3>Procedencia visible</h3>
              <p>Cada dato conservará su fuente, método y fecha.</p>
            </article>
            <article>
              <span>02</span>
              <h3>Privacidad desde el origen</h3>
              <p>Acceso por organización y expediente, con consentimiento.</p>
            </article>
            <article>
              <span>03</span>
              <h3>Escenarios diferenciados</h3>
              <p>Las simulaciones se mostrarán separadas de las mediciones.</p>
            </article>
          </section>
        </main>
        <footer>
          <span>No es un dispositivo médico.</span>
          <span>Textos legales pendientes de revisión · Datos ficticios</span>
        </footer>
      </div>
    </div>
  );
}
