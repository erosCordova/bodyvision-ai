import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivacyRequestsPage } from "../src/features/privacy/PrivacyRequestsPage";

const fixture = vi.hoisted(() => ({
  profileId: "22222222-2222-4222-8222-222222222222",
  profiles: vi.fn(),
  role: "administrator" as "administrator" | "privacy_officer",
}));

vi.mock("../src/app/providers/PrivateAuthProvider", () => ({
  privateAuthEnabled: () => true,
  usePrivateAuth: () => ({ session: {
    role: fixture.role, token: "synthetic-only", organization_id: "org", user_id: "actor",
  } }),
}));
vi.mock("../src/app/providers/WorkspaceProvider", () => ({
  useWorkspace: () => ({ id: "org", api: { profiles: fixture.profiles } }),
}));

afterEach(() => { vi.unstubAllGlobals(); });
beforeEach(() => { fixture.role = "administrator"; fixture.profiles.mockClear(); });

describe("cola de atención de privacidad", () => {
  it("el responsable solo consulta la cola y los consentimientos sin pedir expedientes clínicos", async () => {
    fixture.role = "privacy_officer";
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("/auth/profiles/")) return Response.json({
        items: [], can_record: false, can_revoke: true,
        policy_version: "bv-synthetic-v1", checked_at: "2026-11-22T13:00:00Z",
      });
      return Response.json({ items: [{
        id: "11111111-1111-4111-8111-111111111111", profile_id: fixture.profileId,
        request_type: "access", status: "received",
        requested_by: "33333333-3333-4333-8333-333333333333",
        received_at: "2026-11-22T13:00:00Z", review_target_at: "2026-11-29T13:00:00Z",
        review_started_at: null, reviewed_by: null, profile_code: "BV-FAKE123",
        review_overdue: false, can_review: false,
      }], total: 1, limit: 20, offset: 0 });
    });
    vi.stubGlobal("fetch", fetcher);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><PrivacyRequestsPage /></QueryClientProvider>);
    await screen.findByRole("button", { name: "Iniciar revisión" });
    expect(fixture.profiles).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Registrar solicitud ficticia" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Mis solicitudes del expediente" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Consultar consentimientos de BV-FAKE123" }));
    expect(await screen.findByText("Aún no hay aceptaciones registradas.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar aceptación ficticia" })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.every(([url]) => url.includes("privacy-requests") || url.includes("/consents"))).toBe(true);
    view.unmount(); client.clear();
  });
  it("conserva el aviso de atraso tras iniciar revisión y muestra el objetivo en hora de Lima", async () => {
    fixture.profiles.mockResolvedValue({
      items: [{ id: fixture.profileId, display_code: "BV-FAKE123" }], total: 1,
    });
    const request = {
      id: "11111111-1111-4111-8111-111111111111", profile_id: fixture.profileId,
      request_type: "access", status: "received",
      requested_by: "33333333-3333-4333-8333-333333333333",
      received_at: "2026-11-01T13:00:00Z", review_target_at: "2026-11-08T13:00:00Z",
      review_started_at: null as string | null, reviewed_by: null as string | null,
      profile_code: "BV-FAKE123", review_overdue: true, can_review: true,
    };
    const fetcher = vi.fn(async (input: string, options?: RequestInit) => {
      if (input.endsWith("/review") && options?.method === "POST") {
        request.status = "in_review";
        request.review_started_at = "2026-11-22T13:00:00Z";
        request.reviewed_by = "44444444-4444-4444-8444-444444444444";
        return Response.json(request);
      }
      const result = input.includes("/profiles/") ? [] : [{ ...request }];
      return Response.json({ items: result, total: result.length, limit: 20, offset: 0 });
    });
    vi.stubGlobal("fetch", fetcher);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}>
      <PrivacyRequestsPage />
    </QueryClientProvider>);
    const heading = await screen.findByRole("heading", { name: "Cola de revisión administrativa" });
    const queue = within(heading.closest("section")!);
    expect(await queue.findByText("Atención interna atrasada (no es un plazo legal)."))
      .toBeInTheDocument();
    const target = await queue.findByText(/Objetivo interno de atención \(hora de Lima\)/);
    expect(target).toHaveTextContent("08:00"); // 13:00 UTC, regardless of the browser's zone.
    fireEvent.click(queue.getByRole("button", { name: "Iniciar revisión" }));
    expect(await screen.findByText("Revisión administrativa ficticia iniciada. La solicitud no está resuelta."))
      .toBeInTheDocument();
    expect(queue.getByText(/En revisión/, { selector: "li" })).toBeInTheDocument();
    expect(queue.getByText("Atención interna atrasada (no es un plazo legal)."))
      .toBeInTheDocument();
    expect(queue.getByText(/Objetivo interno de atención \(hora de Lima\)/)).toHaveTextContent("08:00");
    fireEvent.click(queue.getByRole("checkbox", { name: "Solo solicitudes con atención interna atrasada" }));
    await queue.findByText("Atención interna atrasada (no es un plazo legal).");
    expect(fetcher.mock.calls.some(([url]) => url.includes("overdue_only=true"))).toBe(true);
    view.unmount();
    client.clear();
  });
});
