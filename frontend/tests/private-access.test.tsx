import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateAuthProvider, privateAuthEnabled, usePrivateAuth } from "../src/app/providers/PrivateAuthProvider";
import { WorkspaceProvider } from "../src/app/providers/WorkspaceProvider";
import { DataLayout } from "../src/app/layouts/DataLayout";
import { PrivateAccessPage } from "../src/features/access/PrivateAccessPage";

const ORG = "10000000-0000-4000-8000-000000000001";
const USER = "a1000000-0000-4000-8000-000000000001";
const TOKEN = "x".repeat(48);

function withProviders(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PrivateAuthProvider>{children}</PrivateAuthProvider>
    </QueryClientProvider>,
  );
}

function ProtectedHome() {
  const { session, logout } = usePrivateAuth();
  return (
    <div>
      <strong>{session ? "Sesión verificada" : "Sin sesión"}</strong>
      {session && <button onClick={() => { void logout(); }}>Salir</button>}
    </div>
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_ENABLE_PRIVATE_AUTH", "true");
  vi.stubGlobal("fetch", vi.fn());
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("private BODYVISION authentication UI", () => {
  it("requires an actual test flag and never exposes private login in public demo mode", () => {
    expect(privateAuthEnabled()).toBe(true);
    vi.stubEnv("VITE_ENABLE_PRIVATE_AUTH", "false");
    expect(privateAuthEnabled()).toBe(false);
  });

  it("authenticates locally with an opaque memory-only token and offers logout", async () => {
    const expires_at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token: TOKEN,
        organization_id: ORG,
        user_id: USER,
        role: "specialist",
        expires_at,
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    withProviders(
      <MemoryRouter initialEntries={["/access"]}>
        <Routes>
          <Route path="/access" element={<PrivateAccessPage />} />
          <Route path="/" element={<ProtectedHome />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Identificador de organización"), { target: { value: ORG } });
    fireEvent.change(screen.getByLabelText("Correo electrónico"), { target: { value: "fictional@example.invalid" } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "Synthetic test passphrase 2026!" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar al espacio privado" }));
    expect(await screen.findByText("Sesión verificada")).toBeInTheDocument();
    const [path, options] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/v1/auth/login");
    expect(options.cache).toBe("no-store");
    expect(options.credentials).toBe("same-origin");
    expect((options.headers as Record<string, string>)["X-Workspace-ID"]).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Salir" }));
    expect(await screen.findByText("Sin sesión")).toBeInTheDocument();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const [logoutPath, logoutOptions] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(logoutPath).toBe("/api/v1/auth/logout");
    expect((logoutOptions.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(sessionStorage.length).toBe(0);
  });

  it("reports failed credentials without storing them or changing routes", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetcher);
    withProviders(
      <MemoryRouter initialEntries={["/access"]}>
        <Routes>
          <Route path="/access" element={<PrivateAccessPage />} />
          <Route path="/" element={<p>Área privada</p>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Identificador de organización"), { target: { value: ORG } });
    fireEvent.change(screen.getByLabelText("Correo electrónico"), { target: { value: "unknown@example.invalid" } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "Wrong password" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar al espacio privado" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Organización, correo o contraseña incorrectos.");
    expect(screen.queryByText("Área privada")).not.toBeInTheDocument();
    expect((screen.getByLabelText("Contraseña") as HTMLInputElement).value).toBe("");
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("blocks the protected workspace before any private data request without a bearer session", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PrivateAuthProvider>
          <WorkspaceProvider>
            <MemoryRouter initialEntries={["/profiles"]}>
              <Routes>
                <Route path="/access" element={<p>Identifíquese primero</p>} />
                <Route element={<DataLayout />}>
                  <Route path="/profiles" element={<p>Datos de expediente protegido</p>} />
                </Route>
              </Routes>
            </MemoryRouter>
          </WorkspaceProvider>
        </PrivateAuthProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Identifíquese primero")).toBeInTheDocument();
    expect(screen.queryByText("Datos de expediente protegido")).not.toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
