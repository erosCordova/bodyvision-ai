import { useState, type FormEvent } from "react";
import { acceptPrivateInvitation } from "../../services/api/privateInvitations";

/** Public acceptance exists only inside the opt-in private local/test page.
 * A consumed code never creates a login session or grants profile access.
 */
export function PrivateInvitationAcceptance({ onAccepted }: {
  onAccepted: (organizationId: string) => void;
}) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (password.length < 12 || password.length > 128 || password !== repeat) {
      setError("La contraseña de prueba debe tener 12 caracteres como mínimo y coincidir.");
      return;
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(code.trim())) {
      setError("Introduce el código de invitación de 43 caracteres.");
      return;
    }
    setBusy(true); setError("");
    try {
      const result = await acceptPrivateInvitation({ token: code.trim(), password });
      setCode(""); setPassword(""); setRepeat("");
      setAccepted(true);
      onAccepted(result.organization_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo aceptar la invitación.");
      setPassword(""); setRepeat("");
    } finally {
      setBusy(false);
    }
  }

  return <details className="private-invitation-acceptance">
    <summary>Tengo una invitación ficticia</summary>
    {accepted ? <p role="status" className="account-security-success">
      Invitación aceptada. Tu cuenta ficticia está creada, pero aún no tiene permisos sobre expedientes.
      Inicia sesión con tu correo, contraseña y el identificador de organización que te entregó el administrador.
      Si tu rol lo exige, configura el segundo factor.
    </p> : <>
      <p className="private-access-description">Introduce el código entregado por un
        administrador de pruebas. No utilices datos de una persona real.
        El código caduca en 48 horas y solo funciona una vez.</p>
      <form onSubmit={event => { void accept(event); }}>
        <label htmlFor="invitation-accept-code">Código de invitación ficticia</label>
        <input id="invitation-accept-code" type="password" required
          autoComplete="off" minLength={43} maxLength={43}
          value={code} disabled={busy}
          onChange={event => setCode(event.target.value)} />
        <label htmlFor="invitation-accept-password">Crear contraseña de prueba</label>
        <input id="invitation-accept-password" type="password"
          autoComplete="new-password" required minLength={12} maxLength={128}
          value={password} disabled={busy}
          onChange={event => setPassword(event.target.value)} />
        <label htmlFor="invitation-accept-repeat">Repetir contraseña de prueba</label>
        <input id="invitation-accept-repeat" type="password"
          autoComplete="new-password" required minLength={12} maxLength={128}
          value={repeat} disabled={busy}
          onChange={event => setRepeat(event.target.value)} />
        {error && <p role="alert" className="private-access-error">{error}</p>}
        <button type="submit" className="private-access-submit"
          disabled={busy || code.length !== 43 || password.length < 12 || password !== repeat}>
          {busy ? "Aceptando invitación…" : "Crear cuenta ficticia con invitación"}
        </button>
      </form>
    </>}
  </details>;
}
