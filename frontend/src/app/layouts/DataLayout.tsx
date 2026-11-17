import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useWorkspace } from "../providers/WorkspaceProvider";
export function DataLayout() {
  const { id, setId, api, readOnly } = useWorkspace();
  const navigate = useNavigate();
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: api.workspaces,
  });
  return (
    <div className="data-shell">
      <a className="skip-link" href="#main-content">
        Saltar al contenido
      </a>
      <aside className="data-sidebar">
        <NavLink to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            B
          </span>
          <span>
            BODYVISION <strong>AI</strong>
            <small>Registro y visualización</small>
          </span>
        </NavLink>
        <p className="nav-label">ESPACIO DE TRABAJO</p>
        <nav aria-label="Navegación principal">
          <NavLink to="/" aria-label="Resumen" end>
            ◫ <span>Resumen</span>
          </NavLink>
          <NavLink to="/profiles" aria-label="Expedientes">
            ▱ <span>Expedientes</span>
          </NavLink>
          <NavLink to="/system" aria-label="Estado del entorno">
            ↗ <span>Estado del entorno</span>
          </NavLink>
        </nav>
        <div className="data-sidebar-note">
          <span className="phase-label">FASE 2 · DATOS FICTICIOS</span>
          <p>Una historia, cada registro.</p>
          <small>
            Mediciones observadas y cálculos derivados con fuente y fecha.
          </small>
        </div>
      </aside>
      <div className="data-workspace">
        <header className="data-topbar">
          <span>Registro y seguimiento corporal</span>
          <label>
            Organización ficticia
            <select
              aria-label="Organización ficticia"
              value={id}
              onChange={(e) => {
                setId(e.target.value);
                navigate("/");
              }}
              disabled={!workspaces.data}
            >
              {!workspaces.data?.items.some((w) => w.id === id) && (
                <option value={id} hidden>
                  {workspaces.isError ? "No disponible" : "Cargando…"}
                </option>
              )}
              {workspaces.data?.items.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          {workspaces.isError && (
            <button onClick={() => void workspaces.refetch()}>
              Reintentar organizaciones
            </button>
          )}
        </header>
        <div className="synthetic-banner">
          <strong>
            {readOnly
              ? "DEMOSTRACIÓN · SOLO LECTURA"
              : "ENTORNO LOCAL · DATOS FICTICIOS"}
          </strong>
          <span>
            {readOnly
              ? "Explora los expedientes ficticios. Los datos se regeneran al reiniciarse la demo."
              : "Este selector no es autenticación. No introduzcas información de personas reales."}
          </span>
        </div>
        <main id="main-content" className="data-main" key={id}>
          <Outlet />
        </main>
        <footer>
          <span>No es un dispositivo médico.</span>
          <span>Privacidad e identidad: pendientes de Fase 3</span>
        </footer>
      </div>
    </div>
  );
}
