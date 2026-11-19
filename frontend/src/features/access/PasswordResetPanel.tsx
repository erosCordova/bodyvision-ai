import { useState, type FormEvent } from "react";
import { privateAdminApi, type ManagedUser } from "../../services/api/privateAdmin";

type Props = {
  api: Pick<ReturnType<typeof privateAdminApi>, "resetPassword">;
  onChanged: () => void;
  account: ManagedUser | null;
};

export function PasswordResetPanel({ api, onChanged, account }: Props) {
  const [administratorPassword, setAdministratorPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function clearSecrets() {
    setAdministratorPassword(""); setNewPassword(""); setConfirmation("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account?.manageable || account.status !== "active") return;
    setError(""); setNotice("");
    if (newPassword !== confirmation) {
      setError("Las nuevas contraseñas no coinciden."); clearSecrets(); return;
    }
    setBusy(true);
    try {
      const result = await api.resetPassword(account.id, {
        administrator_password: administratorPassword, new_password: newPassword,
      });
      setNotice(`Acceso restablecido. Sesiones revocadas: ${result.revoked_sessions}.`);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo restablecer el acceso.");
      onChanged(); // Also refresh the audit after an authenticated denied attempt.
    } finally {
      clearSecrets(); setBusy(false);
    }
  }

  return <section className="enterprise-panel private-admin-reset" aria-label="Restablecer acceso de prueba">
    <h2>Restablecer acceso</h2>
    <p>Permite cambiar la contraseña de una cuenta ficticia de consulta o especialista de tu organización. Sus sesiones anteriores quedarán revocadas y sus permisos se conservarán.</p>
    <p>Confirma tu identidad como administrador. Este procedimiento no permite restablecer tu propia cuenta ni otras cuentas administradoras.</p>
    {!account?.manageable || account.status !== "active" ? <p>Selecciona una cuenta activa de consulta o especialista en el directorio.</p> : <form className="private-admin-form" onSubmit={event => { void submit(event); }}>
      <p><strong>Usuario seleccionado:</strong> {account.display_name} · {account.email}</p>
      <label htmlFor="reset-administrator-password">Tu contraseña de administrador</label>
      <input id="reset-administrator-password" type="password" autoComplete="off"
        required maxLength={128} value={administratorPassword} disabled={busy}
        onChange={event => setAdministratorPassword(event.target.value)} />
      <label htmlFor="reset-new-password">Nueva contraseña del usuario</label>
      <input id="reset-new-password" type="password" autoComplete="new-password"
        required minLength={12} maxLength={128} value={newPassword} disabled={busy}
        onChange={event => setNewPassword(event.target.value)} />
      <label htmlFor="reset-confirm-password">Confirmar nueva contraseña</label>
      <input id="reset-confirm-password" type="password" autoComplete="new-password"
        required minLength={12} maxLength={128} value={confirmation} disabled={busy}
        onChange={event => setConfirmation(event.target.value)} />
      <small>Usa solo contraseñas de pruebas de 12 a 128 caracteres. El cambio quedará registrado en la auditoría.</small>
      {error && <p role="alert" className="private-admin-error">{error}</p>}
      {notice && <p role="status" className="private-admin-success">{notice}</p>}
      <button type="submit" disabled={busy}>{busy ? "Restableciendo…" : "Restablecer contraseña y revocar sesiones"}</button>
    </form>}
  </section>;
}
