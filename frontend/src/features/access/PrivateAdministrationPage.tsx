import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { usePrivateAuth } from "../../app/providers/PrivateAuthProvider";
import {
  privateAdminApi,
  type AuditEvent,
  type NewTestAccount,
} from "../../services/api/privateAdmin";
import "./private-administration.css";
import { PasswordResetPanel } from "./PasswordResetPanel";

const eventNames: Record<string, string> = {
  "admin.password_reset": "Restablecimiento de contraseña",
  "admin.password_reset_denied": "Restablecimiento denegado",
  "consent.read": "Consulta de consentimientos",
  "consent.accepted": "Aceptación de consentimiento",
  "consent.revoked": "Revocación de consentimiento",
  "auth.login": "Inicio de sesión",
  "auth.logout": "Cierre de sesión",
  "admin.user_provisioned": "Usuario creado",
  "admin.user_provision_denied": "Alta de usuario denegada",
  "admin.audit_denied": "Consulta de auditoría denegada",
  "admin.permission_change_denied": "Cambio de permisos denegado",
  "profile.permission_granted": "Permiso concedido",
  "profile.permission_revoked": "Permiso revocado",
};

const initialAccount: NewTestAccount = {
  display_name: "",
  email: "",
  password: "",
  role: "member",
};

export function PrivateAdministrationPage() {
  const { session } = usePrivateAuth();
  const [account, setAccount] = useState<NewTestAccount>(initialAccount);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [auditStatus, setAuditStatus] = useState<"loading" | "ready" | "error">("loading");
  const [auditError, setAuditError] = useState("");
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  const [creating, setCreating] = useState(false);
  const [permission, setPermission] = useState({
    profile_id: "",
    user_id: "",
    access_level: "read" as "read" | "write" | "manage",
  });
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionError, setPermissionError] = useState("");
  const [permissionSuccess, setPermissionSuccess] = useState("");
  const [auditRevision, setAuditRevision] = useState(0);

  const administrator = session?.role === "administrator";
  const api = useMemo(
    () => (administrator && session ? privateAdminApi(session.token) : null),
    [administrator, session],
  );

  useEffect(() => {
    if (!api) {
      return;
    }
    let active = true;
    api.audit()
      .then(result => {
        if (!active) return;
        setEvents(result);
        setAuditError("");
        setAuditStatus("ready");
      })
      .catch(error => {
        if (!active) return;
        setAuditError(error instanceof Error ? error.message : "Error al consultar auditoría.");
        setAuditStatus("error");
      });
    return () => { active = false; };
  }, [api, auditRevision]);

  const updateAccount = useCallback(
    <K extends keyof NewTestAccount>(key: K, value: NewTestAccount[K]) => {
      setAccount(current => ({ ...current, [key]: value }));
      setFormError("");
      setSuccess("");
    },
    [],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !administrator) return;
    if (!/^[a-z0-9._%+-]+@example\.invalid$/.test(account.email)) {
      setFormError("Solo se permiten correos ficticios terminados en @example.invalid.");
      return;
    }
    setCreating(true);
    setFormError("");
    setSuccess("");
    try {
      const created = await api.createUser(account);
      setSuccess(`Cuenta ficticia creada: ${created.display_name} (${created.role === "member" ? "Consulta" : "Especialista"}).`);
      setAccount(initialAccount);
      setPermission(previous => ({ ...previous, user_id: created.id }));
      setAuditStatus("loading");
      setAuditRevision(previous => previous + 1);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "No se pudo crear la cuenta.");
      // A failed attempt must not leave the password visible in the form.
      setAccount(previous => ({ ...previous, password: "" }));
    } finally {
      setCreating(false);
    }
  }

  async function changePermission(operation: "grant" | "revoke") {
    if (!api || !administrator) return;
    const validUuid = /^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
    if (!validUuid.test(permission.profile_id) || !validUuid.test(permission.user_id)) {
      setPermissionError("Introduce identificadores UUID válidos.");
      return;
    }
    setPermissionBusy(true);
    setPermissionError("");
    setPermissionSuccess("");
    try {
      const payload = {
        profile_id: permission.profile_id,
        user_id: permission.user_id,
      };
      const response = operation === "grant"
        ? await api.grantAccess({ ...payload, access_level: permission.access_level })
        : await api.revokeAccess(payload);
      setPermissionSuccess(response.status === "granted"
        ? "Permiso ficticio concedido durante 30 días."
        : "Permiso revocado. El acceso se bloquea en el servidor inmediatamente.");
      setAuditStatus("loading");
      setAuditRevision(previous => previous + 1);
    } catch (cause) {
      setPermissionError(cause instanceof Error ? cause.message : "No se pudo modificar el permiso.");
    } finally {
      setPermissionBusy(false);
    }
  }

  if (!administrator) {
    return (
      <section className="enterprise-module private-admin" aria-label="Administración restringida">
        <div className="enterprise-panel">
          <span className="eyebrow">ACCESO RESTRINGIDO</span>
          <h1>Administración y seguridad</h1>
          <p>Esta sección es exclusiva de administradores con una sesión verificada.</p>
          <p>Tu rol actual no permite crear cuentas ni consultar la auditoría.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="enterprise-module private-admin" aria-label="Administración privada">
      <div className="private-admin-heading">
        <div>
          <p className="eyebrow">BODYVISION AI · SEGURIDAD</p>
          <h1>Usuarios y auditoría</h1>
          <p>Gestión de cuentas ficticias y seguimiento de accesos en un entorno privado de pruebas.</p>
        </div>
        <span className="private-admin-phase">SOLO PRUEBAS</span>
      </div>
      <div className="private-admin-grid">
        <section className="enterprise-panel" aria-label="Crear usuario ficticio">
          <h2>Crear usuario de prueba</h2>
          <p>Los usuarios se incorporan a tu organización, pero no reciben permisos sobre expedientes hasta que se concedan explícitamente.</p>
          <form className="private-admin-form" onSubmit={event => { void submit(event); }}>
            <label htmlFor="admin-user-name">Nombre ficticio</label>
            <input id="admin-user-name" required minLength={3} maxLength={100}
              value={account.display_name}
              onChange={event => updateAccount("display_name", event.target.value)}
              placeholder="Ej.: Especialista de prueba" />
            <label htmlFor="admin-user-email">Correo ficticio</label>
            <input id="admin-user-email" required type="email" autoComplete="off"
              value={account.email}
              onChange={event => updateAccount("email", event.target.value)}
              placeholder="cuenta@example.invalid" />
            <small>Solo se permiten direcciones con el dominio reservado example.invalid.</small>
            <label htmlFor="admin-user-role">Tipo de usuario</label>
            <select id="admin-user-role" value={account.role}
              onChange={event => updateAccount("role", event.target.value as NewTestAccount["role"])}>
              <option value="member">Usuario de consulta</option>
              <option value="specialist">Especialista</option>
            </select>
            <label htmlFor="admin-user-password">Contraseña de pruebas</label>
            <input id="admin-user-password" type="password" required
              minLength={12} maxLength={128} autoComplete="new-password"
              value={account.password}
              onChange={event => updateAccount("password", event.target.value)} />
            <small>Mínimo 12 caracteres. No utilices contraseñas personales ni reales.</small>
            {formError && <p className="private-admin-error" role="alert">{formError}</p>}
            {success && <p className="private-admin-success" role="status">{success}</p>}
            <button type="submit" disabled={creating}>
              {creating ? "Creando cuenta…" : "Crear cuenta ficticia"}
            </button>
          </form>
        </section>
        <section className="enterprise-panel" aria-label="Auditoría de seguridad">
          <div className="private-admin-audit-head">
            <div>
              <h2>Eventos de seguridad</h2>
              <p>Últimas 30 operaciones de identidad de tu organización. Sin contraseñas ni tokens.</p>
            </div>
            <button type="button" onClick={() => {
              setAuditStatus("loading");
              setAuditRevision(previous => previous + 1);
            }}>Actualizar</button>
          </div>
          {auditStatus === "loading" && <p role="status">Cargando eventos verificados…</p>}
          {auditStatus === "error" && <p role="alert" className="private-admin-error">{auditError}</p>}
          {auditStatus === "ready" && events.length === 0 && (
            <p role="status">Aún no hay eventos de seguridad registrados.</p>
          )}
          {auditStatus === "ready" && events.length > 0 && (
            <div className="private-admin-table-scroll">
              <table className="private-admin-table">
                <caption>Registro limitado a los últimos 30 eventos de identidad.</caption>
                <thead><tr><th>Fecha</th><th>Operación</th><th>Resultado</th></tr></thead>
                <tbody>
                  {events.map(item => (
                    <tr key={item.id}>
                      <td><time dateTime={item.happened_at}>
                        {new Date(item.happened_at).toLocaleString("es-PE")}
                      </time></td>
                      <td>{eventNames[item.action] ?? "Evento de seguridad"}</td>
                      <td><span className={item.outcome === "allowed" ? "private-admin-ok" : "private-admin-no"}>
                        {item.outcome === "allowed" ? "Permitido" : item.outcome === "denied" ? "Denegado" : "Error"}
                      </span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      <section className="enterprise-panel private-admin-permissions" aria-label="Permisos por expediente">
        <h2>Permisos por expediente</h2>
        <p>Concede o revoca permisos sobre un expediente ficticio de tu organización. No puedes asignarte acceso a ti mismo. Las concesiones caducan a los 30 días.</p>
        <form className="private-admin-form" onSubmit={event => {
          event.preventDefault();
          void changePermission("grant");
        }}>
          <label htmlFor="permission-profile">Identificador de expediente</label>
          <input id="permission-profile" type="text" required value={permission.profile_id}
            onChange={event => setPermission(old => ({ ...old, profile_id: event.target.value }))}
            placeholder="UUID del expediente ficticio" />
          <label htmlFor="permission-user">Identificador de usuario</label>
          <input id="permission-user" type="text" required value={permission.user_id}
            onChange={event => setPermission(old => ({ ...old, user_id: event.target.value }))}
            placeholder="UUID del usuario de prueba" />
          <label htmlFor="permission-level">Nivel de acceso</label>
          <select id="permission-level" value={permission.access_level}
            onChange={event => setPermission(old => ({
              ...old, access_level: event.target.value as typeof old.access_level,
            }))}>
            <option value="read">Lectura</option>
            <option value="write">Lectura y edición</option>
            <option value="manage">Gestión del expediente</option>
          </select>
          <small>Los usuarios de consulta únicamente pueden recibir acceso de lectura.</small>
          {permissionError && <p className="private-admin-error" role="alert">{permissionError}</p>}
          {permissionSuccess && <p className="private-admin-success" role="status">{permissionSuccess}</p>}
          <div className="private-admin-permission-actions">
            <button type="submit" disabled={permissionBusy}>
              {permissionBusy ? "Guardando…" : "Conceder permiso"}
            </button>
            <button type="button" className="private-admin-revoke"
              disabled={permissionBusy}
              onClick={() => { void changePermission("revoke"); }}>
              Revocar permiso
            </button>
          </div>
        </form>
      </section>
      {api && <PasswordResetPanel api={api} onChanged={() => {
        setAuditStatus("loading"); setAuditRevision(previous => previous + 1);
      }} />}
      <div className="enterprise-panel private-admin-guardrails">
        <strong>Controles pendientes para uso real</strong>
        <p>El registro actual cubre operaciones de identidad; todavía no representa la auditoría clínica completa. Falta verificación administrativa inicial, MFA, políticas de consentimiento y trazabilidad de cada expediente.</p>
      </div>
    </section>
  );
}
