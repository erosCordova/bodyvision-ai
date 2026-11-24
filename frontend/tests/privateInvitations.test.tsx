import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateInvitationPanel } from "../src/features/access/PrivateInvitationPanel";
import { PrivateInvitationAcceptance } from "../src/features/access/PrivateInvitationAcceptance";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const INVITATION = "a1111111-1111-4111-8111-111111111111";
const USER = "a2222222-2222-4222-8222-222222222222";
const SESSION = "s".repeat(48);
const SECRET = "a".repeat(43);
const PASSWORD = "Testing only password 2026";
const CREATED = {
  id: INVITATION, token: SECRET, role: "member",
  expires_at: "2026-11-24T12:00:00Z",
};
const row = {
  id: INVITATION,
  email: "invited@example.invalid",
  display_name: "Invitado ficticio",
  role: "member", status: "pending",
  created_at: "2026-11-22T12:00:00Z",
  expires_at: CREATED.expires_at,
};
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status, headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("invitation frontend with real backend contract shapes", () => {
  it("administrator issues a test invite, sees its token once, then revokes it", async () => {
    let issued = false;
    let revoked = false;
    const onChanged = vi.fn();
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === "/api/v1/auth/invitations?limit=20&offset=0") {
        return json({ items: issued ? [{ ...row, status: revoked ? "revoked" : "pending" }] : [],
          total: issued ? 1 : 0, limit: 20, offset: 0 });
      }
      if (url === "/api/v1/auth/invitations" && options?.method === "POST") {
        issued = true;
        const body = JSON.parse(String(options.body));
        expect(body).toEqual({
          display_name: row.display_name,
          email: row.email,
          role: "member",
          administrator_password: PASSWORD,
        });
        return json(CREATED, 201);
      }
      if (url === `/api/v1/auth/invitations/${INVITATION}/revoke`) {
        revoked = true;
        return json({ status: "revoked" });
      }
      throw Error("Unexpected private request " + url);
    });
    vi.stubGlobal("fetch", fetcher);
    render(<PrivateInvitationPanel token={SESSION} onChanged={onChanged} />);
    await screen.findByText("0 invitaciones ficticias registradas.");
    fireEvent.change(screen.getByLabelText("Nombre ficticio del invitado"), {
      target: { value: row.display_name },
    });
    fireEvent.change(screen.getByLabelText("Correo ficticio del invitado"), {
      target: { value: row.email },
    });
    fireEvent.change(screen.getByLabelText("Confirmar contraseña del administrador"), {
      target: { value: PASSWORD },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear invitación ficticia" }));
    expect(await screen.findByLabelText("Código de invitación de un solo uso")).toHaveValue(SECRET);
    await screen.findByText("1 invitaciones ficticias registradas.");
    const createdCall = fetcher.mock.calls.find(([url, options]) =>
      url === "/api/v1/auth/invitations" && options?.method === "POST")!;
    expect(createdCall[1]?.headers).toEqual({
      "Content-Type": "application/json", Authorization: `Bearer ${SESSION}`,
    });
    expect(createdCall[1]?.cache).toBe("no-store");
    expect(createdCall[1]?.credentials).toBe("same-origin");
    expect(JSON.stringify(createdCall[1]?.headers)).not.toContain("X-Workspace-ID");
    expect(screen.getByLabelText("Confirmar contraseña del administrador")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Ocultar código definitivamente" }));
    expect(screen.queryByDisplayValue(SECRET)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revocar invitación" }));
    await screen.findByText("Invitación revocada en el servidor.");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Revocar invitación" }))
      .not.toBeInTheDocument());
    expect(onChanged).toHaveBeenCalledTimes(2);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("rejects real email addresses without sending the administrator password", async () => {
    const fetcher = vi.fn(async () => json({ items: [], limit: 20, offset: 0, total: 0 }));
    vi.stubGlobal("fetch", fetcher);
    render(<PrivateInvitationPanel token={SESSION} onChanged={() => {}} />);
    await screen.findByText("0 invitaciones ficticias registradas.");
    fireEvent.change(screen.getByLabelText("Nombre ficticio del invitado"), {
      target: { value: row.display_name },
    });
    fireEvent.change(screen.getByLabelText("Correo ficticio del invitado"), {
      target: { value: "real@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar contraseña del administrador"), {
      target: { value: PASSWORD },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear invitación ficticia" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/example.invalid/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("the invited user accepts a code without cookies, bearer, automatic login or storage", async () => {
    const accepted = vi.fn();
    const fetcher = vi.fn(async (_path: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        token: SECRET, password: PASSWORD,
      });
      return json({ user_id: USER, organization_id: ORGANIZATION, role: "member" }, 201);
    });
    vi.stubGlobal("fetch", fetcher);
    render(<PrivateInvitationAcceptance onAccepted={accepted} />);
    fireEvent.click(screen.getByText("Tengo una invitación ficticia"));
    fireEvent.change(screen.getByLabelText("Código de invitación ficticia"), {
      target: { value: SECRET },
    });
    fireEvent.change(screen.getByLabelText("Crear contraseña de prueba"), {
      target: { value: PASSWORD },
    });
    fireEvent.change(screen.getByLabelText("Repetir contraseña de prueba"), {
      target: { value: PASSWORD },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta ficticia con invitación" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Invitación aceptada");
    expect(accepted).toHaveBeenCalledWith(ORGANIZATION);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/auth/invitations/accept");
    const req = fetcher.mock.calls[0][1]!;
    expect(req.credentials).toBe("omit");
    expect(req.cache).toBe("no-store");
    expect(req.headers).toEqual({ "Content-Type": "application/json" });
    expect(screen.queryByDisplayValue(SECRET)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(PASSWORD)).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("rejects a consumed invitation, does not authenticate and clears the proposed password", async () => {
    const accepted = vi.fn();
    const fetcher = vi.fn(async () => json({ code: "INVITATION_INVALID" }, 401));
    vi.stubGlobal("fetch", fetcher);
    render(<PrivateInvitationAcceptance onAccepted={accepted} />);
    fireEvent.click(screen.getByText("Tengo una invitación ficticia"));
    fireEvent.change(screen.getByLabelText("Código de invitación ficticia"), {
      target: { value: SECRET },
    });
    fireEvent.change(screen.getByLabelText("Crear contraseña de prueba"), {
      target: { value: PASSWORD },
    });
    fireEvent.change(screen.getByLabelText("Repetir contraseña de prueba"), {
      target: { value: PASSWORD },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta ficticia con invitación" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/ya no es válida/);
    expect(accepted).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Crear contraseña de prueba")).toHaveValue("");
    expect(screen.getByLabelText("Repetir contraseña de prueba")).toHaveValue("");
  });
});
