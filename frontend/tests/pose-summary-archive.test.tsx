import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PoseSummaryArchive } from "../src/features/capture/PoseSummaryArchive";
import { poseSummariesApi, type PoseSummaryDraft } from "../src/services/api/poseSummaries";
import { registerPrivateSessionRefresh } from "../src/services/api/sessionInvalidation";

const profile = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
let role = "administrator";
let accepted = true;
let sessionToken = "s".repeat(48);
let sessionUser = actor;
const draft: PoseSummaryDraft = { model_revision: "pose_landmarker_lite/float16/1", detected: true,
  threshold: .5, visible_points: 25, core_visible: 8, quality_state: "reviewable", capture_passed: true };
const row = { ...draft, id: "33333333-3333-4333-8333-333333333333", profile_id: profile,
  created_by: actor, created_at: "2026-11-20T12:00:00Z", algorithm_revision: "pose-review-summary-v1",
  summary_sha256: "0".repeat(64), origin: "client_reported_browser", data_type: "DERIVADO", synthetic: true };
vi.mock("../src/app/providers/PrivateAuthProvider", () => ({ usePrivateAuth: () => ({ session: {
  token: sessionToken, organization_id: actor, user_id: sessionUser, role,
} }) }));
vi.mock("../src/app/providers/WorkspaceProvider", () => ({ useWorkspace: () => ({ api: {
  profiles: async () => ({ items: [{ id: profile, display_code: "POSE-01" }], total: 1 }),
} }) }));
vi.mock("../src/services/api/consents", () => ({ consentsApi: () => ({ history: async () => ({
  can_record: role !== "member",
  items: (accepted ? ["pose", "storage"] : ["pose"]).map(purpose => ({ purpose, effective: true })),
}) }) }));
function mount(summary: PoseSummaryDraft | null = draft, fixedProfileId?: string) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><PoseSummaryArchive summary={summary} runSerial={1} fixedProfileId={fixedProfileId}/></MemoryRouter>
  </QueryClientProvider>);
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200,
  headers: { "Content-Type": "application/json" } });
beforeEach(() => { role = "administrator"; accepted = true; sessionToken = "s".repeat(48); sessionUser = actor; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("projects only minimal fields before sending and parses server provenance", async () => {
  const fetcher = vi.fn().mockResolvedValue(json(row)); vi.stubGlobal("fetch", fetcher);
  const withSecrets = { ...draft, landmarks: [{ x: .5 }], photo: "private bytes", notes: "private name" };
  const result = await poseSummariesApi("s".repeat(48), profile).save(withSecrets, actor);
  expect(result.origin).toBe("client_reported_browser");
  const init = fetcher.mock.calls[0][1] as RequestInit;
  expect(JSON.parse(init.body as string)).toEqual({ ...draft, synthetic_confirmed: true });
  expect(init.headers).toMatchObject({ "Idempotency-Key": actor });
  expect(init.cache).toBe("no-store");
});

it("saves, reloads and deletes a summary after explicit fictional confirmation", async () => {
  let stored: typeof row[] = [];
  vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    if (init.method === "POST") { stored = [row]; return Promise.resolve(json(row)); }
    if (init.method === "DELETE") { stored = []; return Promise.resolve(new Response(null, { status: 204 })); }
    return Promise.resolve(json({ items: stored, total: stored.length, limit: 20, offset: 0 }));
  }));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mount();
  await screen.findByRole("option", { name: "POSE-01" });
  fireEvent.change(screen.getByRole("combobox", { name: "Expediente para resultados de pose" }), { target: { value: profile } });
  await screen.findByRole("checkbox", { name: /Confirmo que el resultado/ });
  const save = screen.getByRole("button", { name: "Guardar resultado de pose" });
  expect(save).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: /Confirmo que el resultado/ }));
  fireEvent.click(save);
  await screen.findByText(/Resumen de pose guardado y auditado/);
  await screen.findByText("Revisable de forma experimental");
  const erase = screen.getByRole("button", { name: "Eliminar resumen de pose" });
  await waitFor(() => expect(erase).toBeEnabled());
  fireEvent.click(erase);
  await screen.findByText(/Resumen eliminado/);
  await waitFor(() => expect(screen.getByRole("status", { name: "Página de resultados de pose" })).toHaveTextContent("0 resúmenes"));
});

it("blocks history without both purposes and offers no write controls to a member", async () => {
  accepted = false;
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const first = mount(); await screen.findByRole("option", { name: "POSE-01" });
  fireEvent.change(screen.getByRole("combobox", { name: "Expediente para resultados de pose" }), { target: { value: profile } });
  await screen.findByText(/Registra aceptaciones vigentes/);
  expect(fetcher).not.toHaveBeenCalled(); first.unmount();
  accepted = true; role = "member";
  fetcher.mockResolvedValue(json({ items: [row], total: 1, limit: 20, offset: 0 }));
  mount(null); await screen.findByRole("option", { name: "POSE-01" });
  fireEvent.change(screen.getByRole("combobox", { name: "Expediente para resultados de pose" }), { target: { value: profile } });
  await screen.findByText("Revisable de forma experimental");
  expect(screen.queryByRole("button", { name: "Guardar resultado de pose" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Eliminar resumen de pose" })).not.toBeInTheDocument();
});


it("reads the fixed profile history without selecting an image or another profile", async () => {
  role = "member";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ items: [row], total: 1, limit: 20, offset: 0 })));
  mount(null, profile);
  await screen.findByText("Revisable de forma experimental");
  expect(screen.queryByLabelText("Expediente para resultados de pose")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Guardar resultado de pose" })).not.toBeInTheDocument();
});

it("keeps the pending save generation through token renewal and reports the saved result", async () => {
  let stored: typeof row[] = [];
  const posts: RequestInit[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter>
    <PoseSummaryArchive summary={draft} runSerial={1} fixedProfileId={profile} />
  </MemoryRouter></QueryClientProvider>;
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    if (init.method === "POST") {
      posts.push(init);
      if (posts.length === 1) return new Response("{}", { status: 401 });
      stored = [row]; return json(row);
    }
    return json({ items: stored, total: stored.length, limit: 20, offset: 0 });
  });
  vi.stubGlobal("fetch", fetcher);
  const view = render(tree());
  const stop = registerPrivateSessionRefresh(async () => {
    sessionToken = "n".repeat(48);
    view.rerender(tree());
    return sessionToken;
  });
  try {
    const confirmation = await screen.findByRole("checkbox", { name: /Confirmo que el resultado/ });
    fireEvent.click(confirmation);
    fireEvent.click(screen.getByRole("button", { name: "Guardar resultado de pose" }));
    await screen.findByText(/Resumen de pose guardado y auditado/);
    await waitFor(() => expect(screen.getByRole("status", { name: "Página de resultados de pose" })).toHaveTextContent("1 resúmenes"));
    expect(posts).toHaveLength(2);
    expect(posts[0].body).toBe(posts[1].body);
    expect((posts[0].headers as Record<string, string>)["Idempotency-Key"])
      .toBe((posts[1].headers as Record<string, string>)["Idempotency-Key"]);
    expect(confirmation).not.toBeChecked();
  } finally { stop(); }
});

it("clears the fictional confirmation when the authenticated user changes", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ items: [], total: 0, limit: 20, offset: 0 })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter>
    <PoseSummaryArchive summary={draft} runSerial={1} fixedProfileId={profile} />
  </MemoryRouter></QueryClientProvider>;
  const view = render(tree());
  const confirmation = await screen.findByRole("checkbox", { name: /Confirmo que el resultado/ });
  fireEvent.click(confirmation); expect(confirmation).toBeChecked();
  sessionUser = profile;
  view.rerender(tree());
  await waitFor(() => expect(screen.getByRole("checkbox", { name: /Confirmo que el resultado/ })).not.toBeChecked());
  expect(screen.getByRole("button", { name: "Guardar resultado de pose" })).toBeDisabled();
});
