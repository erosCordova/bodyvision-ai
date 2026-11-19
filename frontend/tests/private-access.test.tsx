import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateAuthProvider, privateAuthEnabled, usePrivateAuth } from "../src/app/providers/PrivateAuthProvider";
import { WorkspaceProvider } from "../src/app/providers/WorkspaceProvider";
import { DataLayout } from "../src/app/layouts/DataLayout";
import { PrivateAccessPage } from "../src/features/access/PrivateAccessPage";
import { discardStagedCapture, peekCaptureForAnalysis, stageCaptureForAnalysis } from "../src/features/capture/captureHandoff";
import { invalidatePrivateSession } from "../src/services/api/sessionInvalidation";

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
  discardStagedCapture();
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
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [], total: 0, limit: 20, offset: 0, checked_at: new Date().toISOString(),
      })))
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
    const syntheticReview = {
      width: 800, height: 1100, averageBrightness: 120, contrast: 30,
      checks: [], passed: true,
    };
    stageCaptureForAnalysis(new File(["synthetic-photo"], "before-login.png", { type: "image/png" }), syntheticReview);
    expect(peekCaptureForAnalysis()?.file.name).toBe("before-login.png");
    fireEvent.change(screen.getByLabelText("Identificador de organización"), { target: { value: ORG } });
    fireEvent.change(screen.getByLabelText("Correo electrónico"), { target: { value: "fictional@example.invalid" } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "Synthetic test passphrase 2026!" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar al espacio privado" }));
    expect(await screen.findByText("Sesión verificada")).toBeInTheDocument();
    expect(peekCaptureForAnalysis()).toBeNull();
    stageCaptureForAnalysis(new File(["synthetic-photo"], "before-logout.png", { type: "image/png" }), syntheticReview);
    expect(peekCaptureForAnalysis()?.file.name).toBe("before-logout.png");
    const [path, options] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/v1/auth/login");
    expect(options.cache).toBe("no-store");
    expect(options.credentials).toBe("same-origin");
    expect((options.headers as Record<string, string>)["X-Workspace-ID"]).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Salir" }));
    expect(peekCaptureForAnalysis()).toBeNull();
    expect(await screen.findByText("Sin sesión")).toBeInTheDocument();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    const [logoutPath, logoutOptions] = fetcher.mock.calls[2] as [string, RequestInit];
    expect(logoutPath).toBe("/api/v1/auth/logout");
    expect((logoutOptions.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(sessionStorage.length).toBe(0);
  });

  it("discards a photo handoff immediately when the server invalidates the active private session", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        token: TOKEN, organization_id: ORG, user_id: USER, role: "member",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetcher);
    withProviders(
      <MemoryRouter initialEntries={["/access"]}>
        <Routes>
          <Route path="/access" element={<PrivateAccessPage />} />
          <Route path="/" element={<ProtectedHome />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Identificador de organización"), {
      target: { value: ORG },
    });
    fireEvent.change(screen.getByLabelText("Correo electrónico"), {
      target: { value: "synthetic@example.invalid" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "Synthetic password for tests" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar al espacio privado" }));
    expect(await screen.findByText("Sesión verificada")).toBeInTheDocument();
    stageCaptureForAnalysis(
      new File(["pixels"], "sensitive-handoff.png", { type: "image/png" }),
      { width: 800, height: 1100, averageBrightness: 120, contrast: 25,
        passed: true, checks: [] },
    );
    expect(peekCaptureForAnalysis()?.file.name).toBe("sensitive-handoff.png");
    invalidatePrivateSession(TOKEN);
    await waitFor(() => expect(screen.getByText("Sin sesión")).toBeInTheDocument());
    expect(peekCaptureForAnalysis()).toBeNull();
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

  it("enrolls an authenticator without issuing a session before confirmation", async () => {
    const expires_at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const recover = Array.from({ length: 8 }, (_, i) => i.toString(16).padStart(32, "0"));
    const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: "MFA_SETUP_REQUIRED",
      }), { status: 428, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "pending",
        otpauth_uri: `otpauth://totp/BODYVISION?secret=${seed}&issuer=BODYVISION`,
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token: TOKEN,
        organization_id: ORG,
        user_id: USER,
        role: "administrator",
        expires_at,
        recovery_codes: recover,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
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
    fireEvent.change(screen.getByLabelText("Correo electrónico"), { target: { value: "browser.admin@example.invalid" } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "Browser fixtures only 2026!" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar al espacio privado" }));
    const setup = await screen.findByRole("button", { name: "Configurar autenticador" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(0);
    fireEvent.click(setup);
    expect(await screen.findByText(seed)).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByLabelText("Código del autenticador"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Activar verificación" }));
    expect(await screen.findByRole("heading", { name: "Guarda tus códigos de recuperación" }))
      .toBeInTheDocument();
    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText(recover[0])).toHaveLength(1);
    const [url, opts] = fetcher.mock.calls[2] as [string, RequestInit];
    expect(url).toBe("/api/v1/auth/mfa/confirm");
    const submitted = JSON.parse(opts.body as string) as Record<string, string>;
    expect(submitted.code).toBe("123456");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "He guardado mis códigos" }));
    expect(await screen.findByText("Identidad verificada")).toBeInTheDocument();
  });

  it("recovers a lost authenticator using a backup code without storing it", async () => {
    const expires_at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const newSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const codes = Array.from({ length: 8 }, (_, i) => (i + 1).toString(16).padStart(32, "0"));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "pending",
        otpauth_uri: `otpauth://totp/BODYVISION?secret=${newSecret}&issuer=BODYVISION`,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token: TOKEN, organization_id: ORG, user_id: USER,
        role: "specialist", expires_at, recovery_codes: codes,
      }), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify({
        items: [], total: 0, limit: 20, offset: 0, checked_at: new Date().toISOString(),
      })));
    vi.stubGlobal("fetch", fetcher);
    withProviders(
      <MemoryRouter initialEntries={["/access"]}>
        <Routes>
          <Route path="/access" element={<PrivateAccessPage />} />
          <Route path="/" element={<ProtectedHome />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Identificador de organización"), {
      target: { value: ORG },
    });
    fireEvent.change(screen.getByLabelText("Correo electrónico"), {
      target: { value: "browser.admin@example.invalid" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "Browser fixtures only 2026!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Perdí el acceso a mi autenticador" }));
    fireEvent.change(screen.getByLabelText("Código de recuperación disponible"), {
      target: { value: "A".repeat(32) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Restablecer autenticador" }));
    expect(await screen.findByText(newSecret)).toBeInTheDocument();
    const [url, options] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/auth/mfa/recover");
    const payload = JSON.parse(options.body as string) as Record<string, string>;
    expect(payload.recovery_code).toBe("A".repeat(32));
    expect(screen.queryByText("A".repeat(32))).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    fireEvent.change(screen.getByLabelText("Código del autenticador"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Activar verificación" }));
    expect(await screen.findByRole("heading", { name: "Guarda tus códigos de recuperación" }))
      .toBeInTheDocument();
    expect(screen.getByText(codes[0])).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
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
