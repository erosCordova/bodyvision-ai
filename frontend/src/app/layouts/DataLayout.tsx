import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useWorkspace } from "../providers/WorkspaceProvider";
import "../../styles/enterprise.css";

const sections = [
  { route: "/", name: "Dashboard", icon: "▦", short: "Inicio" },
  { route: "/profiles", name: "Expedientes", icon: "▤", short: "Expedientes" },
  { route: "/measurements", name: "Mediciones", icon: "▥", short: "Mediciones" },
  { route: "/capture", name: "Captura corporal", icon: "◫", short: "Captura" },
  { route: "/analysis", name: "Análisis IA", icon: "✧", short: "Análisis" },
  { route: "/body-3d", name: "Visión 3D", icon: "⬡", short: "Visión 3D" },
  { route: "/reports", name: "Reportes", icon: "▧", short: "Reportes" },
  { route: "/administration", name: "Administración", icon: "⚙", short: "Ajustes" },
];

export function DataLayout() {
  const { id, setId, api, readOnly } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const workspaces = useQuery({ queryKey: ["workspaces"], queryFn: api.workspaces });
  const current = sections.find(section => section.route === location.pathname) ||
    (location.pathname.startsWith("/profiles/") ? sections[1] : sections[0]);
  return (
    <div className="data-shell enterprise-shell">
      <a className="skip-link" href="#main-content">Saltar al contenido</a>
      <aside className="data-sidebar enterprise-sidebar">
        <Link to="/" className="brand enterprise-brand">
          <span className="brand-mark" aria-hidden="true">⌘</span>
          <span>BODYVISION <strong>AI</strong><small>Plataforma de análisis corporal</small></span>
        </Link>
        <p className="nav-label">ESPACIO DE TRABAJO</p>
        <nav aria-label="Navegación principal">
          {sections.map(section => (
            <NavLink to={section.route} key={section.route} end={section.route === "/"}
              className={({ isActive }) => isActive ? "active" : undefined} title={section.name}>
              <span className="enterprise-icon" aria-hidden="true">{section.icon}</span>
              <span className="enterprise-nav-label">{section.name}</span>
            </NavLink>
          ))}
        </nav>
        <div className="enterprise-sidebar-bottom">
          <div className="enterprise-workspace-hint">
            <span className="enterprise-demo-dot" />
            <strong>ENTORNO FICTICIO</strong>
            <small>{readOnly ? "Consulta de demostración" : "Operación local de prueba"}</small>
          </div>
          <Link to="/access" className="enterprise-security-link">♙ Acceso y seguridad</Link>
          <p>Los datos médicos reales requieren autenticación, autorización y consentimiento.</p>
        </div>
      </aside>
      <div className="data-workspace enterprise-workspace">
        <header className="data-topbar enterprise-topbar">
          <div className="enterprise-crumbs"><span>BODYVISION AI</span><span>›</span><strong>{current.name}</strong></div>
          <div className="enterprise-topbar-end">
            <span className="enterprise-phase-tag">VERSIÓN DE DESARROLLO</span>
            <label>
              <span className="sr-only">Organización ficticia</span>
              <select aria-label="Organización ficticia" value={id}
                onChange={event => { setId(event.target.value); navigate("/"); }}
                disabled={!workspaces.data}>
                {!workspaces.data?.items.some(w => w.id === id) && (
                  <option value={id} hidden>{workspaces.isError ? "Sin conexión" : "Cargando…"}</option>
                )}
                {workspaces.data?.items.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
            <div className="enterprise-avatar" aria-label="Operador de demostración">BV</div>
          </div>
        </header>
        <div className="enterprise-demo-banner">
          <strong>{readOnly ? "DEMOSTRACIÓN · SOLO LECTURA" : "DATOS FICTICIOS DE DESARROLLO"}</strong>
          <span>
            {readOnly ? "Información sintética. Sin acceso a pacientes reales ni procesamiento de imágenes." :
              "Se usan datos sintéticos: no introduzcas información de personas reales."}
          </span>
          {workspaces.isError && <button onClick={() => void workspaces.refetch()}>Reintentar conexión</button>}
        </div>
        <main id="main-content" className="data-main enterprise-main" key={id}>
          <Outlet />
        </main>
        <footer className="enterprise-footer">
          <span>© BODYVISION AI · Plataforma de referencia</span>
          <span>No es un dispositivo médico. Autenticación y privacidad: implementación pendiente.</span>
        </footer>
      </div>
    </div>
  );
}
