import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountSecurityPanel } from "../src/features/access/AccountSecurityPanel";
import { AuditIntegrityPanel } from "../src/features/access/AuditIntegrityPanel";

const TOKEN = "t".repeat(48);
const CURRENT = "a1000000-0000-4000-8000-000000000001";
const OTHER = "a1000000-0000-4000-8000-000000000002";
const now = new Date().toISOString();
const sessions = {
  items: [
    { id: CURRENT, issued_at: now, expires_at: now, current: true },
    { id: OTHER, issued_at: now, expires_at: now, current: false },
  ], total: 2, limit: 20, offset: 0, checked_at: now,
};
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }); }
function fillPassword(current = "Synthetic current password", next = "Synthetic replacement password", confirmation = next) {
  fireEvent.change(screen.getByLabelText("Contraseña actual"), { target: { value: current } });
  fireEvent.change(screen.getByLabelText("Mi nueva contraseña"), { target: { value: next } });
  fireEvent.change(screen.getByLabelText("Repetir mi nueva contraseña"), { target: { value: confirmation } });
}
afterEach(() => vi.unstubAllGlobals());

describe("own account security", () => {
  it("shows current session and revokes another using password confirmation and bearer only", async () => {
    const ended = vi.fn();
    let revoked = false;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") { revoked = true; return response({ status: "revoked", revoked_sessions: 1, current_revoked: false }); }
      return response(revoked ? { ...sessions, items: [sessions.items[0]], total: 1 } : sessions);
    });
    vi.stubGlobal("fetch", fetcher);
    render(<AccountSecurityPanel token={TOKEN} onSessionEnded={ended} />);
    expect(await screen.findByText("Esta sesión")).toBeInTheDocument();
    const other = screen.getByText("Otra sesión · 2").closest("li")!;
    expect(within(other).getByRole("button")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Confirmar contraseña para cerrar sesiones"), { target: { value: "Synthetic confirmation" } });
    fireEvent.click(within(other).getByRole("button"));
    expect(await screen.findByText("Sesión cerrada. Su acceso quedó revocado en el servidor.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Otra sesión · 2")).not.toBeInTheDocument());
    expect(ended).not.toHaveBeenCalled();
    const call = fetcher.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(call[0]).toBe(`/api/v1/auth/sessions/${OTHER}/revoke`);
    expect(JSON.parse(call[1]!.body as string)).toEqual({ current_password: "Synthetic confirmation" });
    expect(call[1]!.headers).toEqual({ Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" });
    expect(screen.getByLabelText("Confirmar contraseña para cerrar sesiones")).toHaveValue("");
  });

  it("blocks mismatched passwords and clears secrets after a denied confirmation", async () => {
    const fetcher = vi.fn(async (_: string, init?: RequestInit) => init?.method === "POST"
      ? response({ code: "SELF_REAUTH_REQUIRED" }, 403) : response(sessions));
    vi.stubGlobal("fetch", fetcher);
    render(<AccountSecurityPanel token={TOKEN} onSessionEnded={vi.fn()} />);
    await screen.findByText("Esta sesión");
    fillPassword(undefined, undefined, "Different confirmation");
    fireEvent.submit(screen.getByLabelText("Contraseña actual").closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("no coinciden");
    expect(fetcher).toHaveBeenCalledTimes(1);
    fillPassword();
    fireEvent.submit(screen.getByLabelText("Contraseña actual").closest("form")!);
    expect(await screen.findByText("Confirma tu contraseña actual.")).toBeInTheDocument();
    for (const label of ["Contraseña actual", "Mi nueva contraseña", "Repetir mi nueva contraseña"]) {
      expect(screen.getByLabelText(label)).toHaveValue("");
    }
  });

  it("ends the local session only after a successful password change", async () => {
    const ended = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (_: string, init?: RequestInit) => init?.method === "POST"
      ? response({ status: "changed", revoked_sessions: 2, current_revoked: true }) : response(sessions)));
    render(<AccountSecurityPanel token={TOKEN} onSessionEnded={ended} />);
    fillPassword();
    fireEvent.submit(screen.getByLabelText("Contraseña actual").closest("form")!);
    await waitFor(() => expect(ended).toHaveBeenCalledWith(expect.stringContaining("Contraseña actualizada")));
  });

  it("requires confirmation to close all sessions and discards the local session on success", async () => {
    const ended = vi.fn();
    const fetcher = vi.fn(async (_: string, init?: RequestInit) => init?.method === "POST"
      ? response({ status: "revoked", revoked_sessions: 2, current_revoked: true }) : response(sessions));
    vi.stubGlobal("fetch", fetcher);
    render(<AccountSecurityPanel token={TOKEN} onSessionEnded={ended} />);
    const button = await screen.findByRole("button", { name: "Cerrar todas mis sesiones, incluida esta" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Confirmar contraseña para cerrar sesiones"), { target: { value: "Synthetic confirmation" } });
    fireEvent.click(button);
    await waitFor(() => expect(ended).toHaveBeenCalled());
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/sessions/revoke-all"))).toBe(true);
  });
});

describe("audit integrity", () => {
  const checkpoint = { valid: true, checked_events: 42, checkpoint_sequence: 42,
    checkpoint_hash: "a".repeat(64), first_invalid_sequence: null,
    checked_at: now, algorithm: "sha256-chain-v1" };
  it.each([true, false])("shows the server's integrity result, valid=%s", async valid => {
    const refresh = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => response({ ...checkpoint, valid, first_invalid_sequence: valid ? null : 8 })));
    render(<AuditIntegrityPanel token={TOKEN} onVerified={refresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Verificar integridad de auditoría" }));
    expect(await screen.findByRole(valid ? "status" : "alert")).toHaveTextContent(valid ? "Cadena íntegra" : "inconsistencia");
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByText(/42 eventos revisados/)).toBeInTheDocument();
  });
  it("reports a failed check without showing a successful integrity result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({}, 500)));
    render(<AuditIntegrityPanel token={TOKEN} onVerified={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Verificar integridad de auditoría" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo completar");
    expect(screen.queryByText("Cadena íntegra en el punto verificado")).not.toBeInTheDocument();
  });
});
