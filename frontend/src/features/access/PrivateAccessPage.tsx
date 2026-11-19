import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { privateAuthEnabled, usePrivateAuth } from "../../app/providers/PrivateAuthProvider";
import "./private-access.css";
import { AccountSecurityPanel } from "./AccountSecurityPanel";
import { invalidatePrivateSession } from "../../services/api/sessionInvalidation";

const roleLabel = {
  administrator: "Administrador",
  specialist: "Especialista",
  member: "Usuario de consulta",
} as const;

export function PrivateAccessPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, login, logout } = usePrivateAuth();
  const [organizationId, setOrganizationId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visiblePassword, setVisiblePassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [logoutWarning, setLogoutWarning] = useState("");
  const [securityNotice, setSecurityNotice] = useState("");

  if (!privateAuthEnabled()) {
    return <p role="alert">El acceso privado está deshabilitado en este entorno.</p>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSecurityNotice("");
    setBusy(true);
    try {
      await login({
        organization_id: organizationId.trim(),
        email: email.trim(),
        password,
      });
      setPassword("");
      navigate("/", { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo iniciar sesión.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    const revoked = await logout();
    if (!revoked) {
      setLogoutWarning("Se cerró la sesión de este navegador, pero no se confirmó su revocación en el servidor. La sesión remota puede seguir vigente hasta caducar.");
    } else {
      setLogoutWarning("");
    }
    setBusy(false);
  }

  return (
    <div className="private-access">
      <div className="private-access-intro">
        <span className="private-access-brand">BODYVISION <strong>AI</strong></span>
        <p className="eyebrow">ENTORNO PRIVADO · SOLO PRUEBAS</p>
        <h1>Acceso seguro a expedientes.</h1>
        <p>Identidad verificada, permisos por expediente y aislamiento entre organizaciones.</p>
        <div className="private-access-feature">◈ Sesión limitada a ocho horas</div>
        <div className="private-access-feature">◈ Datos ficticios, sin pacientes reales</div>
        <div className="private-access-feature">◈ Credenciales comprobadas por el backend</div>
      </div>
      <main className="private-access-card">
        {session ? (
          <>
            <p className="eyebrow">SESIÓN DE PRUEBA ACTIVA</p>
            <h2>Identidad verificada</h2>
            <p className="private-access-description">Tu sesión privada está activa. Los datos disponibles dependen de los permisos asignados.</p>
            <dl className="private-access-details">
              <div><dt>Perfil</dt><dd>{roleLabel[session.role]}</dd></div>
              <div><dt>Organización</dt><dd>{session.organization_id}</dd></div>
              <div><dt>Caducidad</dt><dd>{new Date(session.expires_at).toLocaleString("es-PE")}</dd></div>
            </dl>
            <Link className="private-access-link" to="/">Ir al espacio autorizado</Link>
            <button className="private-access-secondary" onClick={() => void signOut()} disabled={busy}>
              {busy ? "Cerrando…" : "Cerrar sesión"}
            </button>
            <AccountSecurityPanel key={session.token} token={session.token} onSessionEnded={notice => {
              setSecurityNotice(notice);
              invalidatePrivateSession(session.token);
            }} />
          </>
        ) : (
          <>
            <p className="eyebrow">IDENTIFICACIÓN DE USUARIO</p>
            <h2>Iniciar sesión</h2>
            <p className="private-access-description">Introduzca las credenciales ficticias entregadas por el administrador de pruebas. No utilice credenciales personales.</p>
            {securityNotice && <p role="status" className="account-security-success">{securityNotice}</p>}
            <form onSubmit={event => void submit(event)}>
              <label htmlFor="private-org-id">Identificador de organización</label>
              <input id="private-org-id" type="text" required value={organizationId}
                onChange={event => setOrganizationId(event.target.value)}
                placeholder="UUID de la organización" autoComplete="off"
                pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" />
              <small>Se entrega con el acceso de pruebas.</small>
              <label htmlFor="private-email">Correo electrónico</label>
              <input id="private-email" type="email" autoComplete="username" required
                value={email} onChange={event => setEmail(event.target.value)}
                placeholder="usuario@organizacion.com" />
              <label htmlFor="private-password">Contraseña</label>
              <div className="private-access-password">
                <input id="private-password" type={visiblePassword ? "text" : "password"}
                  autoComplete="current-password" required value={password}
                  onChange={event => setPassword(event.target.value)} />
                <button type="button" aria-label={visiblePassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  onClick={() => setVisiblePassword(previous => !previous)}>
                  {visiblePassword ? "Ocultar" : "Mostrar"}
                </button>
              </div>
              {error && <p role="alert" className="private-access-error">{error}</p>}
              <button type="submit" className="private-access-submit" disabled={busy}>
                {busy ? "Verificando…" : "Ingresar al espacio privado"}
              </button>
            </form>
          </>
        )}
        {(logoutWarning || new URLSearchParams(location.search).get("logout") === "unconfirmed") && (
          <p role="alert" className="private-access-warning">
            {logoutWarning || "La sesión local fue descartada, pero no se pudo confirmar la revocación en el servidor. Puede seguir vigente hasta caducar."}
          </p>
        )}
        <p className="private-access-disclaimer">Esta herramienta está habilitada únicamente en desarrollo local y pruebas. No admite información médica real.</p>
      </main>
    </div>
  );
}
