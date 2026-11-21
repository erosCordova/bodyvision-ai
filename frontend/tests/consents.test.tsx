import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsentPanel } from "../src/features/profiles/ConsentPanel";

const org = "10000000-0000-4000-8000-000000000001";
const actor = "30000000-0000-4000-8000-000000000001";
const profile = "40000000-0000-4000-8000-000000000001";
const consentId = "50000000-0000-4000-8000-000000000001";
const token = "s".repeat(48);

vi.mock("../src/app/providers/PrivateAuthProvider", () => ({
  usePrivateAuth: () => ({ session: {
    organization_id: org, user_id: actor, role: "specialist", token,
  } }),
}));

function state(canRecord = true) {
  return {
    items: [] as object[], can_record: canRecord, can_revoke: canRecord,
    policy_version: "bv-synthetic-v1", checked_at: "2026-11-18T12:00:00Z",
  };
}
function response(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200 });
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><ConsentPanel profileId={profile} /></QueryClientProvider>);
}
afterEach(() => vi.unstubAllGlobals());

describe("profile consent recording", () => {
  it("requires a fresh explicit confirmation for each purpose and uses only the verified session", async () => {
    const fetcher = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return response({ ...state(), items: [{
          id: consentId, purpose: "pose", version: "bv-synthetic-v1", cycle: 1,
          status: "accepted", accepted_at: "2026-11-18T12:00:00Z", revoked_at: null,
          expires_at: "2026-12-18T12:00:00Z", recorded_by: actor, revoked_by: null, effective: true,
        }] });
      }
      return response(state());
    });
    vi.stubGlobal("fetch", fetcher);
    mount();
    const checkbox = await screen.findByRole("checkbox");
    expect(checkbox).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Registrar aceptación ficticia" })).toBeDisabled();
    fireEvent.click(checkbox);
    fireEvent.change(screen.getByLabelText("Finalidad de la aceptación"), { target: { value: "pose" } });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Registrar aceptación ficticia" }));
    await screen.findByText("Aceptación ficticia registrada. Vigencia de prueba: 30 días.");
    expect(checkbox).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Aceptación ya vigente" })).toBeDisabled();
    const posts = fetcher.mock.calls.filter(call => call[1]?.method === "POST");
    expect(posts).toHaveLength(1);
    const [url, init] = posts[0];
    expect(url).toBe(`/api/v1/auth/profiles/${profile}/consents`);
    expect(JSON.parse(init.body)).toEqual({ purpose: "pose", version: "bv-synthetic-v1", confirmed: true });
    expect(init.headers.Authorization).toBe(`Bearer ${token}`);
    expect(init.headers["X-Workspace-ID"]).toBeUndefined();
  });

  it("keeps expired and revoked history visible without granting edit controls to readers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...state(false), items: [{
      id: consentId, purpose: "capture", version: "bv-synthetic-v1", cycle: 1,
      status: "revoked", accepted_at: "2026-10-01T12:00:00Z", revoked_at: "2026-10-02T12:00:00Z",
      expires_at: "2026-10-31T12:00:00Z", recorded_by: actor, revoked_by: actor, effective: false,
    }] })));
    mount();
    await waitFor(() => expect(screen.getByText(/Consulta de consentimientos\./)).toBeVisible());
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Revocar/ })).not.toBeInTheDocument();
    const card = screen.getByRole("article", { name: "Captura de imágenes" });
    expect(within(card).getByText("Sin aceptación vigente")).toBeVisible();
    fireEvent.click(screen.getByText("Historial de aceptaciones y revocaciones"));
    expect(screen.getByText(/Revocado · Ciclo 1/)).toBeVisible();
  });
});
