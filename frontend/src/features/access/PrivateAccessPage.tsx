import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  PrivateAuthError,
  privateAuthEnabled,
  usePrivateAuth,
} from "../../app/providers/PrivateAuthProvider";
import "./private-access.css";
import { AccountSecurityPanel } from "./AccountSecurityPanel";
import { invalidatePrivateSession } from "../../services/api/sessionInvalidation";
import { PrivateInvitationAcceptance } from "./PrivateInvitationAcceptance";

const roleLabel = {
  administrator: "Administrador",
  specialist: "Especialista",
  member: "Usuario de consulta",
} as const;

export function PrivateAccessPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, restoring, idleExpired, login, logout, beginMfaEnrollment, confirmMfaEnrollment, recoverMfaFactor } = usePrivateAuth();
  const [organizationId, setOrganizationId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [needsSetup, setNeedsSetup] = useState(false);
  const [enrollmentUri, setEnrollmentUri] = useState("");
  const [enrollmentCode, setEnrollmentCode] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [visiblePassword, setVisiblePassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [logoutWarning, setLogoutWarning] = useState("");
  const [securityNotice, setSecurityNotice] = useState("");

  if (!privateAuthEnabled()) {
    return <p role="alert">El acceso privado está deshabilitado en este entorno.</p>;
  }
  if (restoring) {
    return <p role="status">Restaurando sesión privada de pruebas…</p>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (recovering) {
      await startRecovery();
      return;
    }
    setError("");
    setSecurityNotice("");
    setBusy(true);
    try {
      await login({
        organization_id: organizationId.trim(),
        email: email.trim(),
        password,
        ...(mfaCode ? { mfa_code: mfaCode.trim() } : {}),
      });
      setPassword("");
      setMfaCode("");
      navigate("/", { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo iniciar sesión.");
      setMfaCode("");
      if (cause instanceof PrivateAuthError && cause.code === "MFA_SETUP_REQUIRED") {
        setNeedsSetup(true);
      } else if (
        !(cause instanceof PrivateAuthError &&
          ["MFA_CODE_REQUIRED", "MFA_CODE_INVALID"].includes(cause.code))
      ) {
        setPassword("");
      }
    } finally {
      setBusy(false);
    }
  }

  function credentials() {
    return {
      organization_id: organizationId.trim(),
      email: email.trim(),
      password,
    };
  }

  async function startEnrollment() {
    setError("");
    setBusy(true);
    try {
      const uri = await beginMfaEnrollment(credentials());
      setEnrollmentUri(uri);
      setNeedsSetup(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo iniciar la verificación.");
    } finally {
      setBusy(false);
    }
  }

  async function startRecovery() {
    setError("");
    setBusy(true);
    try {
      const uri = await recoverMfaFactor({
        ...credentials(),
        recovery_code: recoveryCode.trim(),
      });
      setEnrollmentUri(uri);
      setRecoveryCode("");
      setRecovering(false);
      setNeedsSetup(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo recuperar el segundo factor.");
      setRecoveryCode("");
    } finally {
      setBusy(false);
    }
  }

  async function finishEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const codes = await confirmMfaEnrollment({ ...credentials(), code: enrollmentCode });
      setRecoveryCodes(codes);
      setPassword("");
      setMfaCode("");
      setEnrollmentCode("");
      setEnrollmentUri("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo confirmar la verificación.");
      setEnrollmentCode("");
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
        {session && recoveryCodes.length > 0 ? (
          <section aria-label="Códigos de recuperación" className="private-mfa-recovery">
            <p className="eyebrow">SEGUNDO FACTOR CONFIGURADO</p>
            <h2>Guarda tus códigos de recuperación</h2>
            <p className="private-access-description">
              Estos ocho códigos se muestran una sola vez. Guarda una copia fuera de esta
              aplicación. Cada código sirve para un único inicio de sesión.
            </p>
            <div className="private-mfa-code-grid">
              {recoveryCodes.map(code => <code key={code}>{code}</code>)}
            </div>
            <button type="button" className="private-access-submit"
              onClick={() => setRecoveryCodes([])}>
              He guardado mis códigos
            </button>
          </section>
        ) : session ? (
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
            {idleExpired && <p role="alert" className="private-access-warning">Sesión cerrada tras 15 minutos sin actividad. Inicia sesión nuevamente.</p>}
            {enrollmentUri ? (
              <section aria-label="Activar segundo factor" className="private-mfa-enroll">
                <h3>Vincula tu autenticador</h3>
                <p className="private-access-description">
                  En tu aplicación de códigos temporales, añade una cuenta manualmente
                  con el identificador BODYVISION AI y esta clave privada:
                </p>
                <code className="private-mfa-secret">
                  {new URL(enrollmentUri).searchParams.get("secret")}
                </code>
                <p className="private-access-description">
                  No compartas la clave ni la guardes en fotografías. Introduce el código
                  de seis dígitos para terminar la configuración.
                </p>
                <form onSubmit={event => void finishEnrollment(event)}>
                  <label htmlFor="private-enrollment-code">Código del autenticador</label>
                  <input id="private-enrollment-code" type="text" required
                    pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code"
                    maxLength={6} value={enrollmentCode}
                    onChange={event => setEnrollmentCode(event.target.value)} />
                  {error && <p role="alert" className="private-access-error">{error}</p>}
                  <button type="submit" className="private-access-submit" disabled={busy}>
                    {busy ? "Confirmando…" : "Activar verificación"}
                  </button>
                </form>
              </section>
            ) : (
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
              {recovering ? (
                <>
                  <p className="private-access-description">
                    Para reemplazar el autenticador necesitas tu contraseña
                    y un código de recuperación que no hayas utilizado.
                    Se cerrarán todas las sesiones anteriores.
                  </p>
                  <label htmlFor="private-recovery-code">Código de recuperación disponible</label>
                  <input id="private-recovery-code" type="text" required
                    autoComplete="off" maxLength={64} value={recoveryCode}
                    onChange={event => setRecoveryCode(event.target.value)}
                    placeholder="Código de recuperación" />
                </>
              ) : (
                <>
                  <label htmlFor="private-mfa-code">Código de verificación (si está activado)</label>
              <input id="private-mfa-code" type="text" inputMode="text"
                autoComplete="one-time-code" maxLength={64} value={mfaCode}
                onChange={event => setMfaCode(event.target.value)}
                placeholder="6 dígitos o código de recuperación" />
                </>
              )}
              {error && <p role="alert" className="private-access-error">{error}</p>}
              {recovering ? (
                <button type="button" className="private-access-submit"
                  disabled={busy || !recoveryCode || !password}
                  onClick={() => void startRecovery()}>
                  {busy ? "Restableciendo…" : "Restablecer autenticador"}
                </button>
              ) : (
                <button type="submit" className="private-access-submit" disabled={busy}>
                  {busy ? "Verificando…" : "Ingresar al espacio privado"}
                </button>
              )}
              <button type="button" className="private-access-secondary"
                disabled={busy} onClick={() => {
                  setRecovering(previous => !previous);
                  setError("");
                  setMfaCode("");
                  setRecoveryCode("");
                }}>
                {recovering ? "Volver a iniciar sesión" : "Perdí el acceso a mi autenticador"}
              </button>
              {needsSetup && (
                <button className="private-access-secondary" type="button"
                  disabled={busy || !password} onClick={() => void startEnrollment()}>
                  Configurar autenticador
                </button>
              )}
            </form>
            )}
            {!enrollmentUri && <PrivateInvitationAcceptance onAccepted={setOrganizationId} />}
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
