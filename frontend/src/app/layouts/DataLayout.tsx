import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useWorkspace } from "../providers/WorkspaceProvider";
import { privateAuthEnabled, usePrivateAuth } from "../providers/PrivateAuthProvider";
import "../../styles/enterprise.css";

const sections = [
  { route: "/", name: "Dashboard", icon: "▦", short: "Inicio" },
  { route: "/profiles", name: "Expedientes", icon: "▤", short: "Expedientes" },
  { route: "/measurements", name: "Mediciones", icon: "▥", short: "Mediciones" },
  { route: "/capture", name: "Captura corporal", icon: "◫", short: "Captura" },
  { route: "/analysis", name: "Análisis IA", icon: "✧", short: "Análisis" },
  { route: "/body-3d", name: "Visión 3D", icon: "⬡", short: "Visión 3D" },
  { route: "/analytics", name: "Analítica", icon: "⌁", short: "Analítica" },
  { route: "/consents", name: "Consentimientos", icon: "◇", short: "Consentimiento" },
  { route: "/reports", name: "Reportes", icon: "▧", short: "Reportes" },
  { route: "/privacy", name: "Privacidad", icon: "◇", short: "Privacidad" },
  { route: "/administration", name: "Administración", icon: "⚙", short: "Ajustes" },
];

export function DataLayout() {
  const { id, setId, api, readOnly } = useWorkspace();
  const { session, restoring, logout, idleWarning, continueWorking } = usePrivateAuth();
  const protectedMode = privateAuthEnabled();
  const navigate = useNavigate();
  const location = useLocation();
  const workspaces = useQuery({
    queryKey: ["workspaces", protectedMode ? session?.organization_id : "demo", protectedMode ? session?.user_id : "demo"],
    queryFn: api.workspaces,
    enabled: !protectedMode || Boolean(session),
  });
  const current = location.pathname === "/progress" ? { name: "Estado del proyecto" } : sections.find(section => section.route === location.pathname) ||
    (location.pathname.startsWith("/profiles/") ? sections.find(section => section.route === "/profiles")! : sections[0]);
  if (protectedMode && restoring) return <p role="status">Restaurando sesión privada de pruebas…</p>;
  if (protectedMode && !session) return <Navigate to="/access" replace />;
  const privacyOnly = protectedMode && session?.role === "privacy_officer";
  if (privacyOnly && location.pathname !== "/privacy") return <Navigate to="/privacy" replace />;
  return (
    <div className="data-shell enterprise-shell">
      <a className="skip-link" href="#main-content">Saltar al contenido</a>
      <aside className="data-sidebar enterprise-sidebar">
        <Link to={privacyOnly ? "/privacy" : "/"} className="brand enterprise-brand">
          <span className="brand-mark" aria-hidden="true">⌘</span>
          <span>BODYVISION <strong>AI</strong><small>Plataforma de análisis corporal</small></span>
        </Link>
        <p className="nav-label">ESPACIO DE TRABAJO</p>
        <nav aria-label="Navegación principal">
          {sections.filter(section => privacyOnly ? section.route === "/privacy" :
            section.route !== "/privacy" || protectedMode).map(section => (
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
            <small>{protectedMode ? "Sesión privada de pruebas" : readOnly ? "Consulta de demostración" : "Operación local de prueba"}</small>
          </div>
          <Link to="/access" className="enterprise-security-link">♙ Acceso y seguridad</Link>
          
        </div>
      </aside>
      <div className="data-workspace enterprise-workspace">
        <header className="data-topbar enterprise-topbar">
          <div className="enterprise-crumbs"><span>BODYVISION AI</span><span>›</span><strong>{current.name}</strong></div>
          <div className="enterprise-topbar-end">

            <label>
              <span className="sr-only">Organización ficticia</span>
              <select aria-label="Organización ficticia" value={id}
                onChange={event => { setId(event.target.value); navigate("/"); }}
                disabled={protectedMode || !workspaces.data}>
                {!workspaces.data?.items.some(w => w.id === id) && (
                  <option value={id} hidden>{workspaces.isError ? "Sin conexión" : "Cargando…"}</option>
                )}
                {workspaces.data?.items.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
            {!protectedMode && <Link to="/access" className="enterprise-mobile-access">Acceso</Link>}
            {protectedMode && session && (
              <button type="button" className="enterprise-logout-button"
                onClick={() => { void logout().then(revoked => navigate(revoked ? "/access" : "/access?logout=unconfirmed", { replace: true })); }}>
                Cerrar sesión
              </button>
            )}
            <div className="enterprise-avatar"
              aria-label={protectedMode ? "Identidad verificada de pruebas" : "Operador de demostración"}>
              {protectedMode ? "ID" : "BV"}
            </div>
          </div>
        </header>
        <div className="enterprise-demo-banner">
          <strong>{protectedMode ? "DATOS FICTICIOS · SESIÓN PRIVADA" : readOnly ? "DEMOSTRACIÓN · SOLO LECTURA" : "DATOS FICTICIOS"}</strong>
          <span>
            {protectedMode ? "No introduzcas información personal real." : readOnly ? "Consulta de ejemplo. No apta para uso clínico." :
              "No introduzcas información personal real."}
          </span>
          {workspaces.isError && <button onClick={() => void workspaces.refetch()}>Reintentar conexión</button>}
        </div>
        {protectedMode && session && idleWarning && <div className="enterprise-idle-warning"
          role="status" aria-live="polite">
          <strong>Tu sesión de pruebas se cerrará pronto por inactividad.</strong>
          <span>Quedan menos de 2 minutos.</span>
          <button type="button" onClick={continueWorking}>Continuar trabajando</button>
        </div>}
        <main id="main-content" className="data-main enterprise-main" key={id}>
          <Outlet />
        </main>
        <footer className="enterprise-footer">
          <span>© BODYVISION AI</span>
          <span>No apto para uso clínico.</span>
        </footer>
      </div>
    </div>
  );
}
