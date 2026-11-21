import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { PrivateAuthProvider, usePrivateAuth } from "../src/app/providers/PrivateAuthProvider";
import { invalidatePrivateSession } from "../src/services/api/sessionInvalidation";
import { recordsApi } from "../src/services/api/records";

const organization = "10000000-0000-4000-8000-000000000001";
const token = "t".repeat(48);
function Harness() {
  const { session, login } = usePrivateAuth();
  return <>
    <p>{session ? "Sesión activa" : "Sesión descartada"}</p>
    <button onClick={() => { void login({ organization_id: organization, email: "test@example.invalid", password: "Test passphrase 2026" }); }}>Ingresar</button>
    <button onClick={() => invalidatePrivateSession("o".repeat(48))}>Respuesta antigua</button>
    <button onClick={() => {
      if (session) void recordsApi(organization, session.token).workspaces().catch(() => {});
    }}>Consultar</button>
  </>;
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("clears a revoked session and private cache on HTTP 401 while ignoring stale tokens", async () => {
  vi.stubEnv("VITE_ENABLE_PRIVATE_AUTH", "true");
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      token, organization_id: organization, user_id: "30000000-0000-4000-8000-000000000001",
      role: "member", expires_at: new Date(Date.now() + 3600000).toISOString(),
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: "SESSION_EXPIRED" }), { status: 401 })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PrivateAuthProvider><Harness /></PrivateAuthProvider></QueryClientProvider>);
  fireEvent.click(screen.getByText("Ingresar"));
  await screen.findByText("Sesión activa");
  client.setQueryData(["private-record"], { synthetic: true });
  fireEvent.click(screen.getByText("Respuesta antigua"));
  expect(screen.getByText("Sesión activa")).toBeInTheDocument();
  expect(client.getQueryData(["private-record"])).toEqual({ synthetic: true });
  fireEvent.click(screen.getByText("Consultar"));
  await screen.findByText("Sesión descartada");
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});
