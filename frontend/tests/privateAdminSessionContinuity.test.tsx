import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateAuthProvider, usePrivateAuth } from "../src/app/providers/PrivateAuthProvider";
import { PrivateAdministrationPage } from "../src/features/access/PrivateAdministrationPage";
import { secureRequest } from "../src/services/api/privateRequest";
import {
  onPrivateSessionInvalidated, registerPrivateSessionRefresh, tryRefreshPrivateSession,
} from "../src/services/api/sessionInvalidation";

const ORG = "10000000-0000-4000-8000-000000000001";
const USER = "a1000000-0000-4000-8000-000000000001";
const INVITATION = "a2000000-0000-4000-8000-000000000002";
const A = "a".repeat(48), B = "b".repeat(48), C = "c".repeat(48);
const SECRET = "s".repeat(43);
const PASSWORD = "Synthetic password 2026!";
const credentials = { organization_id: ORG, email: "admin@example.invalid", password: PASSWORD };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
const access = (token: string) => ({
  access_token: token, token_type: "Bearer", organization_id: ORG,
  user_id: USER, role: "administrator", expires_at: new Date(Date.now() + 600000).toISOString(),
});

function Harness({ admin = false }: { admin?: boolean }) {
  const { session, restoring, login, logout } = usePrivateAuth();
  return <>
    <p>{restoring ? "Restaurando" : session ? `Sesión ${session.token}` : "Sin sesión"}</p>
    <button onClick={() => { void login(credentials); }}>Entrar</button>
    <button onClick={() => { void logout(); }}>Salir</button>
    {session && admin && <PrivateAdministrationPage />}
  </>;
}
function mount(admin = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PrivateAuthProvider>
    <Harness admin={admin} />
  </PrivateAuthProvider></QueryClientProvider>);
}

beforeEach(() => {
  vi.stubEnv("VITE_ENABLE_PRIVATE_AUTH", "true"); vi.stubEnv("VITE_PRIVATE_COOKIE_AUTH", "true");
  localStorage.clear(); sessionStorage.clear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("administrative session continuity", () => {
  it("finishes an invitation after JWT renewal without remounting and losing its one-time code", async () => {
    let authenticated = false;
    const mutations: RequestInit[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/access/refresh")) return authenticated ? json(access(B)) : json({}, 401);
      if (url.endsWith("/access/login")) { authenticated = true; return json(access(A)); }
      if (url.includes("/audit?")) return json([]);
      if (url.includes("/users?")) return json({ items: [], total: 0, limit: 50, offset: 0 });
      if (url.includes("/invitations?")) return json({ items: [], total: 0, limit: 20, offset: 0 });
      if (url.endsWith("/invitations")) {
        mutations.push(init!);
        if ((init?.headers as Record<string, string>).Authorization === `Bearer ${A}`) return json({}, 401);
        return json({ id: INVITATION, token: SECRET, role: "member", expires_at: new Date(Date.now() + 86400000).toISOString() }, 201);
      }
      throw Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetcher);
    mount(true);
    await screen.findByText("Sin sesión");
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await screen.findByText(`Sesión ${A}`);
    fireEvent.click(screen.getByRole("button", { name: "Gestionar invitaciones ficticias" }));
    await screen.findByText("0 invitaciones ficticias registradas.");
    fireEvent.change(screen.getByLabelText("Nombre ficticio del invitado"), { target: { value: "Invitado ficticio" } });
    fireEvent.change(screen.getByLabelText("Correo ficticio del invitado"), { target: { value: "guest@example.invalid" } });
    fireEvent.change(screen.getByLabelText("Confirmar contraseña del administrador"), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole("button", { name: "Crear invitación ficticia" }));
    await screen.findByText(`Sesión ${B}`);
    expect(await screen.findByLabelText("Código de invitación de un solo uso")).toHaveValue(SECRET);
    expect(screen.getByLabelText("Confirmar contraseña del administrador")).toHaveValue("");
    expect(mutations).toHaveLength(2);
    expect(mutations[0].body).toBe(mutations[1].body);
    expect(mutations[1].headers).toMatchObject({ Authorization: `Bearer ${B}` });
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it("uses the verified successor for a delayed old-token 401, and forgets predecessors after logout/login", async () => {
    let authenticated = false, logins = 0;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/access/refresh")) return authenticated ? json(access(B)) : json({}, 401);
      if (url.endsWith("/access/login")) { authenticated = true; logins += 1; return json(access(logins === 1 ? A : C)); }
      if (url.endsWith("/access/logout")) return new Response(null, { status: 204 });
      const current = (init?.headers as Record<string, string>).Authorization;
      return current === `Bearer ${B}` ? json([]) : json({}, 401);
    });
    vi.stubGlobal("fetch", fetcher);
    mount();
    await screen.findByText("Sin sesión"); fireEvent.click(screen.getByText("Entrar"));
    await screen.findByText(`Sesión ${A}`);
    await act(async () => { expect(await tryRefreshPrivateSession(A)).toBe(B); });
    await screen.findByText(`Sesión ${B}`);
    expect(await secureRequest(A, "/audit?limit=30")).toEqual([]);
    expect(await tryRefreshPrivateSession("unrelated".repeat(8))).toBeNull();
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/access/refresh"))).toHaveLength(2);
    fireEvent.click(screen.getByText("Salir")); await screen.findByText("Sin sesión");
    fireEvent.click(screen.getByText("Entrar")); await screen.findByText(`Sesión ${C}`);
    expect(await tryRefreshPrivateSession(A)).toBeNull();
    expect(await tryRefreshPrivateSession(B)).toBeNull();
  });

  it("retries only once and invalidates a rejected replacement", async () => {
    const stop = registerPrivateSessionRefresh(async () => B);
    const invalidated = vi.fn(); const unsubscribe = onPrivateSessionInvalidated(invalidated);
    const fetcher = vi.fn().mockResolvedValue(json({}, 401)); vi.stubGlobal("fetch", fetcher);
    try {
      await expect(secureRequest(A, "/audit")).rejects.toThrow("caducado");
      expect(fetcher).toHaveBeenCalledTimes(2); expect(invalidated).toHaveBeenCalledWith(B);
    } finally { stop(); unsubscribe(); }
  });

  it("does not retry a denied mutation or refresh opaque sessions", async () => {
    const refresh = vi.fn().mockResolvedValue(null);
    const stop = registerPrivateSessionRefresh(refresh);
    const fetcher = vi.fn().mockResolvedValueOnce(json({}, 403)).mockResolvedValueOnce(json({}, 401));
    vi.stubGlobal("fetch", fetcher);
    try {
      await expect(secureRequest(A, "/users", { method: "POST", body: "{}" })).rejects.toThrow("permisos");
      expect(refresh).not.toHaveBeenCalled();
      await expect(secureRequest(A, "/users")).rejects.toThrow("caducado");
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { stop(); }
  });

  it("shares one renewal across simultaneous administrative 401 responses", async () => {
    let release!: (token: string) => void;
    const refresh = vi.fn(() => new Promise<string>(resolve => { release = resolve; }));
    const stop = registerPrivateSessionRefresh(refresh);
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
      (init?.headers as Record<string, string>).Authorization === `Bearer ${A}` ? json({}, 401) : json([]));
    vi.stubGlobal("fetch", fetcher);
    try {
      const first = secureRequest(A, "/audit"), second = secureRequest(A, "/invitations");
      await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
      release(B);
      expect(await Promise.all([first, second])).toEqual([[], []]);
      expect(fetcher).toHaveBeenCalledTimes(4);
    } finally { stop(); }
  });
});
