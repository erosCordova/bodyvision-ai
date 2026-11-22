import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateAuthProvider, usePrivateAuth } from "../src/app/providers/PrivateAuthProvider";

const ORG = "10000000-0000-4000-8000-000000000001";
const USER = "a1000000-0000-4000-8000-000000000001";
const JWT = `${"a".repeat(44)}.${"b".repeat(45)}.${"c".repeat(45)}`;
const credentials = {
  organization_id: ORG,
  email: "operator@example.invalid",
  password: "Synthetic password 2026!",
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const access = () => ({
  access_token: JWT, token_type: "Bearer", user_id: USER, organization_id: ORG,
  role: "member", expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
});

function Harness() {
  const { session, idleExpired, login } = usePrivateAuth();
  return <section>
    <p>{session ? "Autenticado" : "Sin sesión"}</p>
    <p>{idleExpired ? "Inactividad detectada" : "Sin bloqueo"}</p>
    <button onClick={() => { void login(credentials); }}>Entrar</button>
  </section>;
}

function mount() {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={query}>
      <PrivateAuthProvider><Harness /></PrivateAuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_ENABLE_PRIVATE_AUTH", "true");
  vi.stubEnv("VITE_PRIVATE_COOKIE_AUTH", "true");
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("private idle session end-to-end browser boundary", () => {
  it("revokes the cookie and clears RAM after sleep without user interaction", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ code: "REFRESH_REQUIRED" }, 401))
      .mockResolvedValueOnce(response(access()))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    mount();
    await screen.findByText("Sin sesión");
    fireEvent.click(screen.getByText("Entrar"));
    await screen.findByText("Autenticado");
    const start = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(start + 16 * 60_000);
    fireEvent.focus(window);
    await screen.findByText("Sin sesión");
    expect(screen.getByText("Inactividad detectada")).toBeInTheDocument();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/auth/access/refresh",
      "/api/v1/auth/access/login",
      "/api/v1/auth/access/logout",
    ]);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("sends an authenticated heartbeat only for interaction, not background refresh", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ code: "REFRESH_REQUIRED" }, 401))
      .mockResolvedValueOnce(response(access()))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    mount();
    await screen.findByText("Sin sesión");
    fireEvent.click(screen.getByText("Entrar"));
    await screen.findByText("Autenticado");
    const start = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(start + 2 * 60_000);
    fireEvent.keyDown(window, { key: "a" });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    const [path, init] = fetcher.mock.calls[2] as [string, RequestInit];
    expect(path).toBe("/api/v1/auth/activity");
    expect(init.headers).toEqual({ Authorization: `Bearer ${JWT}` });
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("same-origin");
    // A page becoming visible does not count as an interaction.
    vi.spyOn(Date, "now").mockReturnValue(start + 18 * 60_000);
    fireEvent.focus(window);
    await screen.findByText("Sin sesión");
    expect(screen.getByText("Inactividad detectada")).toBeInTheDocument();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
  });

  it("ends the local session on an authoritative 401 activity response", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ code: "REFRESH_REQUIRED" }, 401))
      .mockResolvedValueOnce(response(access()))
      .mockResolvedValueOnce(response({ code: "SESSION_EXPIRED" }, 401))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    mount();
    await screen.findByText("Sin sesión");
    fireEvent.click(screen.getByText("Entrar"));
    await screen.findByText("Autenticado");
    const start = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(start + 2 * 60_000);
    fireEvent.pointerDown(window);
    await screen.findByText("Sin sesión");
    expect(screen.getByText("Inactividad detectada")).toBeInTheDocument();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
  });
});
