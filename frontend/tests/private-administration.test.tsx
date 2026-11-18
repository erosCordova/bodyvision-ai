import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateAuthProvider } from "../src/app/providers/PrivateAuthProvider";
import { PrivateAccessPage } from "../src/features/access/PrivateAccessPage";
import { PrivateAdministrationPage } from "../src/features/access/PrivateAdministrationPage";
import { privateAdminApi } from "../src/services/api/privateAdmin";

const ORG = "10000000-0000-4000-8000-000000000001";
const USER = "a1000000-0000-4000-8000-000000000001";
const CREATED = "a2000000-0000-4000-8000-000000000002";
const EVENT = "a3000000-0000-4000-8000-000000000003";
const TOKEN = "s".repeat(48);
const credentials = {
  organization_id: ORG,
  user_id: USER,
  token: TOKEN,
  expires_at: new Date(Date.now() + 3600000).toISOString(),
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PrivateAuthProvider>
        <MemoryRouter initialEntries={["/access"]}>
          <Routes>
            <Route path="/access" element={<PrivateAccessPage />} />
            <Route path="/" element={<PrivateAdministrationPage />} />
          </Routes>
        </MemoryRouter>
      </PrivateAuthProvider>
    </QueryClientProvider>,
  );
}

function login() {
  fireEvent.change(screen.getByLabelText("Identificador de organización"), {
    target: { value: ORG },
  });
  fireEvent.change(screen.getByLabelText("Correo electrónico"), {
    target: { value: "administrator@example.invalid" },
  });
  fireEvent.change(screen.getByLabelText("Contraseña"), {
    target: { value: "Fictional strong passphrase" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ingresar al espacio privado" }));
}

beforeEach(() => {
  vi.stubEnv("VITE_ENABLE_PRIVATE_AUTH", "true");
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("private administrator interface", () => {
  it("creates synthetic members with bearer-only requests and refreshes audit", async () => {
    const event = {
      id: EVENT,
      actor_id: USER,
      action: "admin.user_provisioned",
      resource_type: "user",
      resource_id: CREATED,
      outcome: "allowed",
      happened_at: new Date().toISOString(),
    };
    const fetcher = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === "/api/v1/auth/login") {
        return jsonResponse({ ...credentials, role: "administrator" });
      }
      if (url === "/api/v1/auth/audit?limit=30") return jsonResponse([event]);
      if (url === "/api/v1/auth/users") {
        const submitted = JSON.parse(String(options?.body)) as { role: string; email: string };
        return jsonResponse({
          id: CREATED, organization_id: ORG,
          display_name: "Especialista ficticio", email: submitted.email,
          role: submitted.role, status: "active",
        }, 201);
      }
      throw new Error("Unexpected URL");
    });
    vi.stubGlobal("fetch", fetcher);
    mount();
    login();
    expect(await screen.findByRole("heading", { name: "Usuarios y auditoría" })).toBeInTheDocument();
    expect(await screen.findByText("Usuario creado")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nombre ficticio"), {
      target: { value: "Especialista ficticio" },
    });
    fireEvent.change(screen.getByLabelText("Correo ficticio"), {
      target: { value: "specialist@example.invalid" },
    });
    fireEvent.change(screen.getByLabelText("Tipo de usuario"), {
      target: { value: "specialist" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña de pruebas"), {
      target: { value: "Test-only password 2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta ficticia" }));
    expect(await screen.findByText(/Cuenta ficticia creada: Especialista ficticio/)).toBeInTheDocument();

    const calls = fetcher.mock.calls as [string, RequestInit][];
    const [requestUrl, request] = calls.find(([url]) => url === "/api/v1/auth/users")!;
    expect(requestUrl).toBe("/api/v1/auth/users");
    expect((request.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect((request.headers as Record<string, string>)["X-Workspace-ID"]).toBeUndefined();
    expect(request.cache).toBe("no-store");
    expect(request.credentials).toBe("same-origin");
    expect(JSON.parse(request.body as string).organization_id).toBeUndefined();
    expect(JSON.parse(request.body as string).role).toBe("specialist");
    expect((screen.getByLabelText("Contraseña de pruebas") as HTMLInputElement).value).toBe("");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    await waitFor(() =>
      expect(calls.filter(([url]) => url === "/api/v1/auth/audit?limit=30").length).toBe(2),
    );
  });

  it("does not fetch audit or show account forms for a nonadministrator", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({ ...credentials, role: "member" }),
    );
    vi.stubGlobal("fetch", fetcher);
    mount();
    login();
    expect(await screen.findByRole("heading", { name: "Administración y seguridad" })).toBeInTheDocument();
    expect(screen.getByText("Esta sección es exclusiva de administradores con una sesión verificada.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Correo ficticio")).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refuses out-of-scope emails before creating an account", async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/v1/auth/login") return jsonResponse({ ...credentials, role: "administrator" });
      if (url === "/api/v1/auth/audit?limit=30") return jsonResponse([]);
      throw new Error("Unexpected private write");
    });
    vi.stubGlobal("fetch", fetcher);
    mount();
    login();
    await screen.findByRole("heading", { name: "Usuarios y auditoría" });
    fireEvent.change(screen.getByLabelText("Nombre ficticio"), {
      target: { value: "Usuario de test" },
    });
    fireEvent.change(screen.getByLabelText("Correo ficticio"), {
      target: { value: "real@company.com" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña de pruebas"), {
      target: { value: "Testing password 2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta ficticia" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Solo se permiten correos ficticios");
    expect(fetcher.mock.calls.filter(([url]) => url === "/api/v1/auth/users")).toHaveLength(0);
  });

  it("rejects invalid or expired sessions in direct API calls", async () => {
    await expect(privateAdminApi("short").audit()).rejects.toThrow("sesión");
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(privateAdminApi(TOKEN).audit()).rejects.toThrow("permisos");
  });
});


describe("private per-expediente permission management", () => {
  it("allows an administrator to grant and revoke a fictional user's access", async () => {
    const profile = "a4000000-0000-4000-8000-000000000004";
    const fetcher = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === "/api/v1/auth/login") return jsonResponse({ ...credentials, role: "administrator" });
      if (url === "/api/v1/auth/audit?limit=30") return jsonResponse([]);
      if (url === "/api/v1/auth/profile-access/grant") {
        const payload = JSON.parse(String(options?.body));
        return jsonResponse({ profile_id: payload.profile_id, user_id: payload.user_id, status: "granted" });
      }
      if (url === "/api/v1/auth/profile-access/revoke") {
        const payload = JSON.parse(String(options?.body));
        return jsonResponse({ profile_id: payload.profile_id, user_id: payload.user_id, status: "revoked" });
      }
      throw new Error("Unexpected API request");
    });
    vi.stubGlobal("fetch", fetcher);
    mount();
    login();
    await screen.findByRole("heading", { name: "Usuarios y auditoría" });
    fireEvent.change(screen.getByLabelText("Identificador de expediente"), {
      target: { value: profile },
    });
    fireEvent.change(screen.getByLabelText("Identificador de usuario"), {
      target: { value: CREATED },
    });
    fireEvent.change(screen.getByLabelText("Nivel de acceso"), {
      target: { value: "read" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Conceder permiso" }));
    expect(await screen.findByText("Permiso ficticio concedido durante 30 días.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revocar permiso" }));
    expect(await screen.findByText(/Permiso revocado/)).toBeInTheDocument();

    const calls = fetcher.mock.calls as [string, RequestInit][];
    const grantCall = calls.find(([url]) => url === "/api/v1/auth/profile-access/grant");
    const revokeCall = calls.find(([url]) => url === "/api/v1/auth/profile-access/revoke");
    expect(grantCall).toBeDefined();
    expect(revokeCall).toBeDefined();
    expect(JSON.parse(String(grantCall![1].body))).toEqual({
      profile_id: profile, user_id: CREATED, access_level: "read",
    });
    expect(JSON.parse(String(revokeCall![1].body))).toEqual({
      profile_id: profile, user_id: CREATED,
    });
    expect((grantCall![1].headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect((grantCall![1].headers as Record<string, string>)["X-Workspace-ID"]).toBeUndefined();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("does not send invalid expediente or user identifiers", async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/v1/auth/login") return jsonResponse({ ...credentials, role: "administrator" });
      if (url === "/api/v1/auth/audit?limit=30") return jsonResponse([]);
      throw new Error("Unexpected write");
    });
    vi.stubGlobal("fetch", fetcher);
    mount();
    login();
    await screen.findByRole("heading", { name: "Usuarios y auditoría" });
    fireEvent.change(screen.getByLabelText("Identificador de expediente"), {
      target: { value: "invalid" },
    });
    fireEvent.change(screen.getByLabelText("Identificador de usuario"), {
      target: { value: CREATED },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revocar permiso" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("identificadores UUID válidos");
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("profile-access"))).toHaveLength(0);
  });
});
