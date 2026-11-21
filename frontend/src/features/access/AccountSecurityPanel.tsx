import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { accountSecurityApi, type OwnSessions } from "../../services/api/accountSecurity";
import "./account-security.css";

export function AccountSecurityPanel({ token, onSessionEnded }: {
  token: string; onSessionEnded: (notice: string) => void;
}) {
  const api = useMemo(() => accountSecurityApi(token), [token]);
  const [sessions, setSessions] = useState<OwnSessions | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [sessionPassword, setSessionPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError("");
    api.sessions(offset).then(result => {
      if (active) { setSessions(result); setLoading(false); }
    }).catch(cause => {
      if (active) { setLoadError(cause instanceof Error ? cause.message : "No se pudieron consultar las sesiones."); setLoading(false); }
    });
    return () => { active = false; };
  }, [api, offset, revision]);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPasswordError("");
    if (newPassword !== confirmation) { setPasswordError("Las contraseñas nuevas no coinciden."); return; }
    if (currentPassword === newPassword) { setPasswordError("Elige una contraseña diferente de la actual."); return; }
    setBusy(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      onSessionEnded("Contraseña actualizada. Se cerraron todas tus sesiones; ingresa con la nueva contraseña.");
    } catch (cause) {
      setPasswordError(cause instanceof Error ? cause.message : "No se pudo cambiar la contraseña.");
    } finally {
      setCurrentPassword(""); setNewPassword(""); setConfirmation(""); setBusy(false);
    }
  }
  async function revoke(identifier: string | null) {
    if (!sessionPassword || busy) return;
    setBusy(true); setSessionError(""); setNotice("");
    try {
      const result = await api.revoke(identifier, sessionPassword);
      if (result.current_revoked) onSessionEnded("Sesión cerrada en el servidor. Vuelve a identificarte para continuar.");
      else {
        setNotice("Sesión cerrada. Su acceso quedó revocado en el servidor.");
        setSessions(previous => previous ? { ...previous, items: previous.items.filter(item => item.id !== identifier), total: previous.total - result.revoked_sessions } : null);
        if (offset > 0 && sessions?.items.length === 1) setOffset(Math.max(0, offset - 20));
        else refresh();
      }
    } catch (cause) {
      setSessionError(cause instanceof Error ? cause.message : "No se pudo cerrar la sesión.");
    } finally { setSessionPassword(""); setBusy(false); }
  }

  return <div className="account-security">
    <section aria-label="Cambiar mi contraseña">
      <h3>Cambiar mi contraseña</h3>
      <p>Al guardar se cerrarán todas tus sesiones, incluida esta. Tus permisos se conservan.</p>
      <form onSubmit={event => void changePassword(event)}>
        <label htmlFor="own-current-password">Contraseña actual</label>
        <input id="own-current-password" type="password" autoComplete="current-password" required maxLength={128}
          value={currentPassword} disabled={busy} onChange={event => setCurrentPassword(event.target.value)} />
        <label htmlFor="own-new-password">Mi nueva contraseña</label>
        <input id="own-new-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}
          value={newPassword} disabled={busy} onChange={event => setNewPassword(event.target.value)} />
        <label htmlFor="own-confirm-password">Repetir mi nueva contraseña</label>
        <input id="own-confirm-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}
          value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} />
        <small>Mínimo 12 caracteres. Usa únicamente credenciales de prueba.</small>
        {passwordError && <p role="alert" className="private-access-error">{passwordError}</p>}
        <button className="private-access-submit" disabled={busy} type="submit">Cambiar contraseña y cerrar sesiones</button>
      </form>
    </section>
    <section aria-label="Mis sesiones activas">
      <div className="account-session-heading"><h3>Mis sesiones activas</h3><button type="button" disabled={busy || loading} onClick={refresh}>Actualizar sesiones</button></div>
      <p>Identificadas por su fecha de apertura. Solo se muestran sesiones de tu cuenta.</p>
      {loading ? <p role="status">Consultando sesiones…</p> : loadError ? <p role="alert" className="private-access-error">{loadError}</p> : sessions && <>
        <p>{sessions.total} {sessions.total === 1 ? "sesión activa" : "sesiones activas"}</p>
        {sessions.items.length === 0 && <p>No hay sesiones en esta página.</p>}
        <label htmlFor="own-session-password">Confirmar contraseña para cerrar sesiones</label>
        <input id="own-session-password" type="password" autoComplete="current-password" maxLength={128}
          value={sessionPassword} disabled={busy} onChange={event => setSessionPassword(event.target.value)} />
        <ul className="account-session-list">{sessions.items.map((item, index) => <li key={item.id}>
          <div><strong>{item.current ? "Esta sesión" : `Otra sesión · ${offset + index + 1}`}</strong>
            <time dateTime={item.issued_at}>Inicio: {new Date(item.issued_at).toLocaleString("es-PE")}</time>
            <small>Vence: {new Date(item.expires_at).toLocaleString("es-PE")}</small></div>
          <button type="button" disabled={busy || !sessionPassword} onClick={() => void revoke(item.id)}
            aria-label={item.current ? "Cerrar esta sesión" : `Cerrar sesión del ${new Date(item.issued_at).toLocaleString("es-PE")}`}>
            Cerrar{item.current ? " esta sesión" : " sesión"}
          </button>
        </li>)}</ul>
        {sessions.total > sessions.limit && <div className="account-session-pagination">
          <button type="button" disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - sessions.limit))}>Sesiones anteriores</button>
          <span>Página {Math.floor(offset / sessions.limit) + 1}</span>
          <button type="button" disabled={busy || offset + sessions.limit >= sessions.total} onClick={() => setOffset(offset + sessions.limit)}>Más sesiones</button>
        </div>}
        <button type="button" className="private-access-secondary" disabled={busy || !sessionPassword || sessions.total === 0}
          onClick={() => void revoke(null)}>Cerrar todas mis sesiones, incluida esta</button>
      </>}
      {sessionError && <p role="alert" className="private-access-error">{sessionError}</p>}
      {notice && <p role="status" className="account-security-success">{notice}</p>}
    </section>
  </div>;
}
