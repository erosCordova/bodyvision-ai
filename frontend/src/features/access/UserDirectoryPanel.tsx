import { useEffect, useState } from "react";
import { privateAdminApi, type ManagedUser } from "../../services/api/privateAdmin";

export const roleNames = { administrator: "Administrador", specialist: "Especialista", member: "Consulta", privacy_officer: "Responsable de privacidad", unassigned: "Sin rol vigente" };
export const accountNames = { active: "Activa", disabled: "Suspendida", locked: "Bloqueada" };

type Props = {
  api: ReturnType<typeof privateAdminApi>;
  revision: number;
  selected: ManagedUser | null;
  onSelect: (account: ManagedUser) => void;
  onChanged: (account: ManagedUser) => void;
};

export function UserDirectoryPanel({ api, revision, selected, onSelect, onChanged }: Props) {
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<ManagedUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true); setError("");
      api.users(search, offset).then(result => {
        if (active) { setRows(result.items); setTotal(result.total); setLoading(false); }
      }).catch(cause => {
        if (active) { setError(cause instanceof Error ? cause.message : "No se pudo cargar el directorio."); setLoading(false); }
      });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [api, revision, search, offset, retry]);
  async function changeState() {
    if (!selected?.manageable || !password) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api.changeAccountStatus(selected.id,
        selected.status === "active" ? "disabled" : "active", password);
      setRows(current => current.map(user => user.id === selected.id ? { ...user, status: result.status } : user));
      onChanged({ ...selected, status: result.status });
      setNotice(result.status === "disabled"
        ? `Cuenta suspendida. Sesiones revocadas: ${result.revoked_sessions}.`
        : "Cuenta reactivada. Debe iniciar una sesión nueva.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo cambiar el estado."); }
    finally { setPassword(""); setBusy(false); setRetry(previous => previous + 1); }
  }
  return <section className="enterprise-panel private-admin-directory" aria-label="Directorio de usuarios">
    <h2>Usuarios de la organización</h2>
    <p>Busca una cuenta y selecciónala para gestionar sus permisos, restablecer su acceso o cambiar su estado.</p>
    <label className="private-admin-search">Buscar usuario por nombre o correo
      <input type="search" value={search} onChange={event => { setSearch(event.target.value); setOffset(0); }} />
    </label>
    {loading && <p role="status">Cargando usuarios…</p>}
    {error && <p role="alert" className="private-admin-error">{error}</p>}
    {!loading && rows.length === 0 && !error && <p>No hay cuentas con esa búsqueda.</p>}
    {!loading && rows.length > 0 && <div className="private-admin-table-scroll"><table className="private-admin-table">
      <caption>Directorio limitado a tu organización.</caption>
      <thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Acción</th></tr></thead>
      <tbody>{rows.map(user => <tr key={user.id} className={selected?.id === user.id ? "private-admin-selected" : undefined}>
        <td><strong>{user.display_name}</strong><br />{user.email}</td>
        <td>{roleNames[user.role]}</td><td>{accountNames[user.status]}</td>
        <td><button type="button" aria-label={`Seleccionar ${user.email}`} disabled={busy}
          onClick={() => { setPassword(""); setNotice(""); setError(""); onSelect(user); }}>Seleccionar</button></td>
      </tr>)}</tbody>
    </table></div>}
    <div className="private-admin-pagination"><span>{total === 1 ? "1 cuenta encontrada" : `${total} cuentas encontradas`}</span>
      <button type="button" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Anterior página de usuarios</button>
      <button type="button" disabled={loading || offset + 50 >= total} onClick={() => setOffset(offset + 50)}>Siguiente página de usuarios</button>
      <button type="button" disabled={loading} onClick={() => setRetry(previous => previous + 1)}>Actualizar usuarios</button>
    </div>
    {selected && <div className="private-admin-selected-account">
      <h3>Cuenta seleccionada</h3><strong>{selected.display_name}</strong><p>{selected.email} · {roleNames[selected.role]} · {accountNames[selected.status]}</p>
      {selected.manageable ? <form className="private-admin-form" onSubmit={event => { event.preventDefault(); void changeState(); }}>
        <p>{selected.status === "active" ? "Suspender cierra sus sesiones e impide nuevos accesos. Sus permisos se conservan y siguen sujetos a su vencimiento." : "Reactivar permite volver a iniciar sesión; las sesiones revocadas no se recuperan."}</p>
        <label htmlFor="account-status-password">Confirmar contraseña para cambiar estado</label>
        <input id="account-status-password" type="password" autoComplete="off" required maxLength={128}
          disabled={busy} value={password} onChange={event => setPassword(event.target.value)} />
        <button type="submit" disabled={busy || !password}>
          {busy ? "Actualizando cuenta…" : selected.status === "active" ? "Suspender cuenta" : "Reactivar cuenta"}
        </button>
      </form> : <p>Esta cuenta está protegida o no tiene un rol vigente; no admite cambios desde este panel.</p>}
    </div>}
    {notice && <p role="status" className="private-admin-success">{notice}</p>}
  </section>;
}
