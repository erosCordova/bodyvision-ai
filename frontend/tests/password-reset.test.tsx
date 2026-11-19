import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PasswordResetPanel } from "../src/features/access/PasswordResetPanel";

const userId = "30000000-0000-4000-8000-000000000002";
const account = { id: userId, display_name: "Usuario ficticio", email: "user@example.invalid", role: "member" as const, status: "active" as const, manageable: true };

function fill(confirm = "New fictional password 2026!") {
  fireEvent.change(screen.getByLabelText("Tu contraseña de administrador"), { target: { value: "Administrator test passphrase" } });
  fireEvent.change(screen.getByLabelText("Nueva contraseña del usuario"), { target: { value: "New fictional password 2026!" } });
  fireEvent.change(screen.getByLabelText("Confirmar nueva contraseña"), { target: { value: confirm } });
}
function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Restablecer contraseña y revocar sesiones" }));
}
function expectSecretsCleared() {
  for (const label of ["Tu contraseña de administrador", "Nueva contraseña del usuario", "Confirmar nueva contraseña"]) {
    expect(screen.getByLabelText(label)).toHaveValue("");
  }
}

describe("administrator-assisted password reset", () => {
  it("requires matching confirmation before sending credentials", () => {
    const resetPassword = vi.fn();
    render(<PasswordResetPanel account={account} api={{ resetPassword }} onChanged={vi.fn()} />);
    fill("Different fictional password 2026!"); submit();
    expect(screen.getByRole("alert")).toHaveTextContent("Las nuevas contraseñas no coinciden.");
    expect(resetPassword).not.toHaveBeenCalled();
    expectSecretsCleared();
  });

  it("clears both passwords after success and refreshes the audit", async () => {
    const resetPassword = vi.fn().mockResolvedValue({ user_id: userId, status: "reset", revoked_sessions: 2 });
    const changed = vi.fn();
    render(<PasswordResetPanel account={account} api={{ resetPassword }} onChanged={changed} />);
    fill(); submit();
    await screen.findByText("Acceso restablecido. Sesiones revocadas: 2.");
    expect(resetPassword).toHaveBeenCalledWith(userId, {
      administrator_password: "Administrator test passphrase", new_password: "New fictional password 2026!",
    });
    expectSecretsCleared();
    expect(changed).toHaveBeenCalledOnce();
  });

  it("does not claim success on server denial and clears entered secrets", async () => {
    const resetPassword = vi.fn().mockRejectedValue(new Error("Confirma la contraseña del administrador."));
    const changed = vi.fn();
    render(<PasswordResetPanel account={account} api={{ resetPassword }} onChanged={changed} />);
    fill(); submit();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Confirma la contraseña del administrador."));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expectSecretsCleared();
    expect(changed).toHaveBeenCalledOnce();
  });
});
