import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { DataLayout } from "../src/app/layouts/DataLayout";

vi.mock("../src/app/providers/PrivateAuthProvider", () => ({
  privateAuthEnabled: () => true,
  sessionRequired: () => true,
  sandboxAuthEnabled: () => false,
  usePrivateAuth: () => ({
    session: { user_id: "actor", role: "privacy_officer" }, restoring: false,
    logout: vi.fn(), idleWarning: false, continueWorking: vi.fn(),
  }),
}));
vi.mock("../src/app/providers/WorkspaceProvider", () => ({
  useWorkspace: () => ({ id: "org", setId: vi.fn(), readOnly: true,
    api: { workspaces: async () => ({ items: [{ id: "org", name: "Organización ficticia" }] }) },
  }),
}));

it("redirige al responsable a privacidad y limita su navegación", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={["/profiles"]}><Routes>
      <Route element={<DataLayout />}>
        <Route path="/profiles" element={<h1>Datos corporales</h1>} />
        <Route path="/privacy" element={<h1>Cola autorizada</h1>} />
      </Route>
    </Routes></MemoryRouter>
  </QueryClientProvider>);
  expect(await screen.findByRole("heading", { name: "Cola autorizada" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Datos corporales" })).not.toBeInTheDocument();
  const nav = within(screen.getByRole("navigation", { name: "Navegación principal" }));
  expect(nav.getAllByRole("link")).toHaveLength(1);
  expect(nav.getByRole("link", { name: /Privacidad/ })).toHaveAttribute("href", "/privacy");
  view.unmount(); client.clear();
});
