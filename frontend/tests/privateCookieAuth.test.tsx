import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateAuthProvider, usePrivateAuth } from "../src/app/providers/PrivateAuthProvider";
import { recordsApi } from "../src/services/api/records";

const ORG = "10000000-0000-4000-8000-000000000001";
const USER = "a1000000-0000-4000-8000-000000000001";
const JWT_A = `${"a".repeat(45)}.${"b".repeat(45)}.${"c".repeat(45)}`;
const JWT_B = `${"d".repeat(45)}.${"e".repeat(45)}.${"f".repeat(45)}`;
const credentials = {
  organization_id: ORG, email: "operator@example.invalid", password: "Synthetic password 2026!",
};
const access = (token: string) => ({
  access_token: token, token_type: "Bearer", organization_id: ORG,
  user_id: USER, role: "specialist",
  expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function Harness() {
  const { session, restoring, login, logout } = usePrivateAuth();
  return <div>
    <p>{restoring ? "Restaurando" : session ? "Autenticado" : "Sin sesión"}</p>
    {session && <p>Token: {session.token}</p>}
    <button onClick={() => { void login(credentials); }}>Entrar</button>
    <button onClick={() => { void logout(); }}>Salir</button>
    <button onClick={() => {
      if (session) void recordsApi(ORG, session.token).workspaces()
        .then(() => document.body.setAttribute("data-request", "ok"))
        .catch(() => document.body.setAttribute("data-request", "failed"));
    }}>Consultar</button>
  </div>;
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}>
    <PrivateAuthProvider><Harness /></PrivateAuthProvider>
  </QueryClientProvider>);
  return { ...view, client };
}

beforeEach(() => {
  vi.stubEnv("VITE_ENABLE_PRIVATE_AUTH", "true");
  vi.stubEnv("VITE_PRIVATE_COOKIE_AUTH", "true");
  sessionStorage.clear();
  localStorage.clear();
  document.body.removeAttribute("data-request");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("F3 private JWT access and rotating HttpOnly refresh", () => {
  it("restores an existing cookie without loading private data before verification", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(access(JWT_A)));
    vi.stubGlobal("fetch", fetcher);
    mount();
    expect(screen.getByText("Restaurando")).toBeInTheDocument();
    await screen.findByText("Autenticado");
    expect(screen.getByText(`Token: ${JWT_A}`)).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/auth/access/refresh");
    expect(init.credentials).toBe("same-origin");
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe("XMLHttpRequest");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("starts a cookie session and revokes it without a bearer logout header", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ code: "REFRESH_REQUIRED" }, 401))
      .mockResolvedValueOnce(json(access(JWT_A)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    mount();
    await screen.findByText("Sin sesión");
    fireEvent.click(screen.getByText("Entrar"));
    await screen.findByText("Autenticado");
    expect(fetcher.mock.calls[1][0]).toBe("/api/v1/auth/access/login");
    const loginInit = fetcher.mock.calls[1][1] as RequestInit;
    expect(loginInit.credentials).toBe("same-origin");
    expect(loginInit.cache).toBe("no-store");
    expect((loginInit.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(loginInit.body as string)).toEqual(credentials);
    fireEvent.click(screen.getByText("Salir"));
    await screen.findByText("Sin sesión");
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    const [url, init] = fetcher.mock.calls[2] as [string, RequestInit];
    expect(url).toBe("/api/v1/auth/access/logout");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("retries one protected request with a new JWT after a 401", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ code: "REFRESH_REQUIRED" }, 401))
      .mockResolvedValueOnce(json(access(JWT_A)))
      .mockResolvedValueOnce(json({ code: "ACCESS_TOKEN_INVALID" }, 401))
      .mockResolvedValueOnce(json(access(JWT_B)))
      .mockResolvedValueOnce(json({
        items: [{ id: ORG, name: "Centro de pruebas" }],
        synthetic: true, read_only: true, notice: "Solo pruebas",
      }));
    vi.stubGlobal("fetch", fetcher);
    mount();
    await screen.findByText("Sin sesión");
    fireEvent.click(screen.getByText("Entrar"));
    await screen.findByText("Autenticado");
    fireEvent.click(screen.getByText("Consultar"));
    await waitFor(() => expect(document.body.getAttribute("data-request")).toBe("ok"));
    await screen.findByText(`Token: ${JWT_B}`);
    expect(fetcher.mock.calls.map((x: unknown[]) => x[0])).toEqual([
      "/api/v1/auth/access/refresh",
      "/api/v1/auth/access/login",
      "/api/v1/workspaces",
      "/api/v1/auth/access/refresh",
      "/api/v1/workspaces",
    ]);
    expect((fetcher.mock.calls[2][1] as RequestInit).headers).toMatchObject({
      Authorization: `Bearer ${JWT_A}`,
    });
    expect((fetcher.mock.calls[4][1] as RequestInit).headers).toMatchObject({
      Authorization: `Bearer ${JWT_B}`,
    });
    expect((fetcher.mock.calls[4][1] as RequestInit).headers).not.toHaveProperty("X-Workspace-ID");
  });

  it("rejects failed refresh after 401 and clears the private session", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ code: "REFRESH_REQUIRED" }, 401))
      .mockResolvedValueOnce(json(access(JWT_A)))
      .mockResolvedValueOnce(json({ code: "ACCESS_TOKEN_REVOKED" }, 401))
      .mockResolvedValueOnce(json({ code: "SESSION_EXPIRED" }, 401));
    vi.stubGlobal("fetch", fetcher);
    mount();
    await screen.findByText("Sin sesión");
    fireEvent.click(screen.getByText("Entrar"));
    await screen.findByText("Autenticado");
    fireEvent.click(screen.getByText("Consultar"));
    await waitFor(() => expect(document.body.getAttribute("data-request")).toBe("failed"));
    await screen.findByText("Sin sesión");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("finishes a pending refresh before logout to revoke the latest cookie", async () => {
    let resolveRefresh!: (response: Response) => void;
    let refreshCount = 0;
    const fetcher = vi.fn((url: string) => {
      if (url === "/api/v1/auth/access/refresh") {
        refreshCount += 1;
        if (refreshCount === 1) return Promise.resolve(json({ code: "REFRESH_REQUIRED" }, 401));
        return new Promise<Response>(done => { resolveRefresh = done; });
      }
      if (url === "/api/v1/auth/access/login") return Promise.resolve(json(access(JWT_A)));
      if (url === "/api/v1/workspaces") return Promise.resolve(json({ code: "ACCESS_TOKEN_INVALID" }, 401));
      if (url === "/api/v1/auth/access/logout") return Promise.resolve(new Response(null, { status: 204 }));
      throw new Error("Unexpected synthetic endpoint");
    });
    vi.stubGlobal("fetch", fetcher);
    mount();
    await screen.findByText("Sin sesión");
    fireEvent.click(screen.getByText("Entrar"));
    await screen.findByText("Autenticado");
    fireEvent.click(screen.getByText("Consultar"));
    await waitFor(() => expect(refreshCount).toBe(2));
    fireEvent.click(screen.getByText("Salir"));
    await screen.findByText("Sin sesión");
    expect(fetcher.mock.calls.some(([url]) => url === "/api/v1/auth/access/logout")).toBe(false);
    resolveRefresh(json(access(JWT_B)));
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url === "/api/v1/auth/access/logout")).toBe(true));
    const calls = fetcher.mock.calls.map(([url]) => url);
    expect(calls.lastIndexOf("/api/v1/auth/access/logout"))
      .toBeGreaterThan(calls.lastIndexOf("/api/v1/auth/access/refresh"));
    expect(screen.getByText("Sin sesión")).toBeInTheDocument();
  });

  it("does not accept a refresh that changes organization or role", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ code: "REFRESH_REQUIRED" }, 401))
      .mockResolvedValueOnce(json(access(JWT_A)))
      .mockResolvedValueOnce(json({ code: "ACCESS_TOKEN_INVALID" }, 401))
      .mockResolvedValueOnce(json({ ...access(JWT_B), role: "administrator" }));
    vi.stubGlobal("fetch", fetcher);
    mount();
    await screen.findByText("Sin sesión");
    fireEvent.click(screen.getByText("Entrar"));
    await screen.findByText("Autenticado");
    fireEvent.click(screen.getByText("Consultar"));
    await screen.findByText("Sin sesión");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
