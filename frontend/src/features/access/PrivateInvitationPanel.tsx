import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  privateInvitationAdminApi, type InvitationCreate, type InvitationCreated,
} from "../../services/api/privateInvitations";

const initialForm: InvitationCreate = {
  display_name: "",
  email: "",
  role: "member",
  administrator_password: "",
};
const statusLabel = {
  pending: "Pendiente",
  expired: "Vencida",
  accepted: "Aceptada",
  revoked: "Revocada",
} as const;

/** Admin-only local/test invitation workflow.
 * The one-time token is held only in this mounted component's RAM.
 */
export function PrivateInvitationPanel({ token, onChanged }: {
  token: string;
  onChanged: () => void;
}) {
  const api = useMemo(() => privateInvitationAdminApi(token), [token]);
  const [form, setForm] = useState<InvitationCreate>(initialForm);
  const [created, setCreated] = useState<InvitationCreated | null>(null);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<Awaited<ReturnType<typeof api.list>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let live = true;
    setLoading(true);
    api.list(offset).then(result => {
      if (!live) return;
      setPage(result);
      setLoading(false);
      setError("");
    }).catch(cause => {
      if (!live) return;
      setLoading(false);
      setError(cause instanceof Error ? cause.message : "No se pudieron consultar invitaciones.");
    });
    return () => { live = false; };
  }, [api, offset, revision]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const email = form.email.trim().toLowerCase();
    if (!/^[a-z0-9._%+-]+@example\.invalid$/.test(email)) {
      setError("Solo se permiten correos ficticios @example.invalid.");
      return;
    }
    if (form.display_name.trim().length < 3 || !form.administrator_password) {
      setError("Indica nombre ficticio y contraseña del administrador.");
      return;
    }
    setBusy(true); setError(""); setNotice(""); setCreated(null);
    try {
      const result = await api.create({
        email, display_name: form.display_name.trim(),
        role: form.role, administrator_password: form.administrator_password,
      });
      setCreated(result);
      setForm(initialForm);
      setOffset(0);
      setRevision(value => value + 1);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear la invitación.");
      setForm(previous => ({ ...previous, administrator_password: "" }));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api.revoke(id);
      if (created?.id === id) setCreated(null);
      setNotice("Invitación revocada en el servidor.");
      setRevision(value => value + 1);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo revocar la invitación.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="enterprise-panel private-admin-invitations"
    aria-label="Invitaciones de usuarios ficticios">
    <h2>Invitaciones de prueba</h2>
    <p>Emite un código válido durante 48 horas para que otra cuenta ficticia elija
      su propia contraseña. No se envían correos y ningún invitado obtiene acceso
      a expedientes hasta recibir permisos explícitos.</p>
    <form className="private-admin-form" onSubmit={event => { void create(event); }}>
      <label htmlFor="invite-display-name">Nombre ficticio del invitado</label>
      <input id="invite-display-name" required minLength={3} maxLength={100}
        value={form.display_name} disabled={busy}
        onChange={event => setForm(v => ({ ...v, display_name: event.target.value }))} />
      <label htmlFor="invite-email">Correo ficticio del invitado</label>
      <input id="invite-email" type="email" required autoComplete="off"
        placeholder="invitado@example.invalid" value={form.email} disabled={busy}
        onChange={event => setForm(v => ({ ...v, email: event.target.value }))} />
      <label htmlFor="invite-role">Rol del invitado</label>
      <select id="invite-role" value={form.role} disabled={busy}
        onChange={event => setForm(v => ({
          ...v, role: event.target.value as InvitationCreate["role"],
        }))}>
        <option value="member">Usuario de consulta</option>
        <option value="specialist">Especialista</option>
      </select>
      <label htmlFor="invite-admin-password">Confirmar contraseña del administrador</label>
      <input id="invite-admin-password" type="password" autoComplete="current-password"
        required maxLength={128} disabled={busy}
        value={form.administrator_password}
        onChange={event => setForm(v => ({ ...v, administrator_password: event.target.value }))} />
      <button type="submit" disabled={busy}>
        {busy ? "Emitiendo invitación…" : "Crear invitación ficticia"}
      </button>
    </form>
    {created && <div className="private-admin-invitation-secret"
      role="status" aria-label="Código de invitación emitido una sola vez">
      <strong>Código de invitación (única visualización)</strong>
      <p>Entrégalo manualmente al invitado de prueba. No se envía por correo.
        Vence el {new Date(created.expires_at).toLocaleString("es-PE")}.
        No podrás consultarlo nuevamente tras ocultarlo.</p>
      <input readOnly aria-label="Código de invitación de un solo uso"
        autoComplete="off" value={created.token} onFocus={event => event.target.select()} />
      <button type="button" onClick={() => setCreated(null)}>Ocultar código definitivamente</button>
    </div>}
    {error && <p role="alert" className="private-admin-error">{error}</p>}
    {notice && <p role="status" className="private-admin-success">{notice}</p>}
    <div className="private-admin-audit-head">
      <h3>Historial de invitaciones</h3>
      <button type="button" disabled={busy || loading}
        onClick={() => setRevision(value => value + 1)}>Actualizar invitaciones</button>
    </div>
    {loading && <p role="status">Consultando invitaciones…</p>}
    {!loading && page && <>
      <p>{page.total} invitaciones ficticias registradas.</p>
      <ul className="private-admin-invitation-list">
        {page.items.map(item => <li key={item.id}>
          <div><strong>{item.display_name}</strong>
            <span>{item.email} · {item.role === "member" ? "Consulta" : "Especialista"}
              {" · "}{statusLabel[item.status]}</span>
            <small>Vence el {new Date(item.expires_at).toLocaleString("es-PE")}</small>
          </div>
          {item.status === "pending" && <button type="button" disabled={busy}
            onClick={() => { void revoke(item.id); }}>Revocar invitación</button>}
        </li>)}
      </ul>
      {page.total > page.limit && <nav className="private-admin-pagination"
        aria-label="Páginas de invitaciones">
        <button type="button" disabled={busy || offset === 0}
          onClick={() => setOffset(v => Math.max(0, v - page.limit))}>Anterior</button>
        <span>{offset + 1}–{Math.min(offset + page.limit, page.total)} de {page.total}</span>
        <button type="button" disabled={busy || offset + page.limit >= page.total}
          onClick={() => setOffset(v => v + page.limit)}>Siguiente</button>
      </nav>}
    </>}
  </section>;
}
