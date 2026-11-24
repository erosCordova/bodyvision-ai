import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useWorkspace } from "../providers/WorkspaceProvider";
import { privateAuthEnabled, sandboxAuthEnabled, sessionRequired, usePrivateAuth } from "../providers/PrivateAuthProvider";
import "../../styles/enterprise.css";

const sections = [
  { route: "/", name: "Resumen", icon: "▦", short: "Inicio" },
  { route: "/profiles", name: "Expedientes", icon: "▤", short: "Expedientes" },
  { route: "/measurements", name: "Mediciones", icon: "▥", short: "Mediciones" },
  { route: "/capture", name: "Captura corporal", icon: "◫", short: "Captura" },
  { route: "/analysis", name: "Análisis IA", icon: "✧", short: "Análisis" },
  { route: "/body-3d", name: "Visión 3D", icon: "⬡", short: "Visión 3D" },
  { route: "/analytics", name: "Evolución", icon: "⌁", short: "Analítica" },
  { route: "/consents", name: "Consentimientos", icon: "◇", short: "Consentimiento" },
  { route: "/reports", name: "Reportes", icon: "▧", short: "Reportes" },
  { route: "/privacy", name: "Privacidad", icon: "◇", short: "Privacidad" },
  { route: "/administration", name: "Administración", icon: "⚙", short: "Ajustes" },
];

export function DataLayout() {
  const { id, setId, api, readOnly } = useWorkspace();
  const { session, restoring, logout, idleWarning, continueWorking } = usePrivateAuth();
  const protectedMode = sessionRequired();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenu,setMobileMenu]=useState(false);
  const selectedProfile=location.pathname.match(/^\/profiles\/([^/]+)$/)?.[1]??new URLSearchParams(location.search).get("profile")??"";
  const scopedPath=(route:string)=>selectedProfile&&["/capture","/analysis","/analytics","/reports","/body-3d"].includes(route)?route+"?"+new URLSearchParams({profile:selectedProfile,...(route==="/body-3d"?{panel:"grasa"}:{})}):route;
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
      <aside className={"data-sidebar enterprise-sidebar"+(mobileMenu?" mobile-open":"")}>
        <Link to={privacyOnly ? "/privacy" : "/"} className="brand enterprise-brand">
          <span className="brand-mark" aria-hidden="true">⌘</span>
          <span>BODYVISION <strong>AI</strong></span>
        </Link>
        <button type="button" className="bv-mobile-menu" aria-expanded={mobileMenu} aria-controls="bv-main-nav" onClick={()=>setMobileMenu(v=>!v)}>{mobileMenu?"Cerrar menú":"Menú"} <span aria-hidden="true">{mobileMenu?"×":"☰"}</span></button>
        <nav id="bv-main-nav" aria-label="Navegación principal">
          {[
            {label:"Seguimiento",routes:["/","/profiles","/measurements","/analytics"]},
            {label:"Evaluación",routes:["/capture","/analysis","/body-3d","/reports"]},
            {label:"Configuración",routes:["/consents","/privacy","/administration"]},
          ].map(group=>{
            const items=group.routes.map(route=>sections.find(s=>s.route===route)!).filter(section=>privacyOnly?section.route==="/privacy":(section.route!=="/privacy"||privateAuthEnabled())&&(section.route!=="/consents"||!sandboxAuthEnabled()));
            return items.length>0&&<div className="bv-nav-group" key={group.label}><p className="nav-label">{group.label}</p>{items.map(section=><NavLink to={scopedPath(section.route)} key={section.route} end={section.route==="/"} onClick={()=>setMobileMenu(false)} className={({isActive})=>isActive?"active":undefined}><span className="enterprise-icon" aria-hidden="true">{section.icon}</span><span className="enterprise-nav-label">{section.name}</span></NavLink>)}</div>;
          })}
        </nav>
        <div className="enterprise-sidebar-bottom">
          <div className="enterprise-workspace-hint">
            <span className="enterprise-demo-dot" />
            <strong>Espacio de pruebas</strong>
          </div>
          <Link to="/access" className="enterprise-security-link">♙ Mi cuenta</Link>
          
        </div>
      </aside>
      <div className="data-workspace enterprise-workspace">
        <header className="data-topbar enterprise-topbar">
          <div className="enterprise-crumbs"><strong>{current.name}</strong></div>
          <div className="enterprise-topbar-end">

            {!protectedMode&&<label>
              <span className="sr-only">Organización ficticia</span>
              <select aria-label="Organización ficticia" value={id}
                onChange={event => { setId(event.target.value); navigate("/"); }}
                disabled={protectedMode || !workspaces.data}>
                {!workspaces.data?.items.some(w => w.id === id) && (
                  <option value={id} hidden>{workspaces.isError ? "Sin conexión" : "Cargando…"}</option>
                )}
                {workspaces.data?.items.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>}
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
          <strong>{readOnly?"Solo lectura":"Datos ficticios"}</strong>
          <span>
            No introducir datos personales reales.
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
          <span>BodyVision AI · No apto para uso clínico</span>
        </footer>
      </div>
    </div>
  );
}
