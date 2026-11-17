import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FoundationPage } from "../src/features/foundation/FoundationPage";

function show() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <MemoryRouter>
        <FoundationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const live = {
  status: "alive",
  service: "bodyvision-api",
  version: "0.1.0",
  phase: 1,
  environment: "test",
  checked_at: "2026-11-17T12:00:00Z",
};
const ready = {
  status: "ready",
  database: "connected",
  schema_revision: "0001_foundation",
  checked_at: "2026-11-17T12:00:00Z",
};
function success() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        new Response(JSON.stringify(url.endsWith("live") ? live : ready)),
      ),
    ),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe("Foundation view", () => {
  it("renders loading and disables requests until completed", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    show();
    expect(screen.getAllByText("Consultando el servicio…")).toHaveLength(2);
    screen
      .getAllByRole("button")
      .forEach((button) => expect(button).toBeDisabled());
  });
  it("displays successful responses and an honest empty state", async () => {
    success();
    show();
    expect(await screen.findByText("✓ API en ejecución")).toBeVisible();
    expect(await screen.findByText("✓ Base de datos conectada")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Abrir espacio de trabajo" }),
    ).toBeVisible();
    expect(screen.getByText(/No es un dispositivo médico/)).toBeVisible();
  });
  it("shows references and recovers from a connection error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("network"))),
    );
    show();
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    expect(screen.getAllByText(/Referencia:/)).toHaveLength(2);
    success();
    await userEvent.click(
      screen.getAllByRole("button", { name: "Volver a consultar" })[0],
    );
    expect(await screen.findByText("✓ API en ejecución")).toBeVisible();
  });
  it("clears successful status when a later check fails", async () => {
    success();
    show();
    await screen.findByText("✓ API en ejecución");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("network"))),
    );
    await userEvent.click(
      screen.getAllByRole("button", { name: "Volver a consultar" })[0],
    );
    await screen.findByRole("alert");
    expect(screen.queryByText("✓ API en ejecución")).not.toBeInTheDocument();
  });
  it("does not accept malformed API responses as a successful check", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response('{"status":"alive"}'))),
    );
    show();
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
  });
});
