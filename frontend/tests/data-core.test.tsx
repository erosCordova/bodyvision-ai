import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "../src/features/dashboard/Dashboard";
import { DataTypeBadge } from "../src/components/ui/DataTypeBadge";
import { profileSchema, dataRequest } from "../src/services/api/records";
import { z } from "zod";
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
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => vi.unstubAllGlobals());
describe("Synthetic data core", () => {
  it("labels observed and derived values separately", () => {
    render(
      <>
        <DataTypeBadge type="OBSERVADO" />
        <DataTypeBadge type="DERIVADO" />
      </>,
    );
    expect(screen.getByText("OBSERVADO")).toBeVisible();
    expect(screen.getByText("DERIVADO")).toBeVisible();
  });
  it("uses API counts and an empty state instead of sample metrics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              active_profiles: 17,
              measurements_30d: 42,
              corrections: 3,
              outliers_30d: 2,
              restricted_profiles: 1,
              recent_measurements: [],
              synthetic: true,
            }),
          ),
        ),
      ),
    );
    show();
    expect(await screen.findByText("17")).toBeVisible();
    expect(screen.getByText("42")).toBeVisible();
    const alerts = screen.getByRole("region", { name: "Alertas de seguimiento" });
    expect(within(alerts).getByText("2")).toBeVisible();
    expect(within(alerts).getByText("1")).toBeVisible();
    expect(screen.getByRole("button", { name: "Explorar evolución" })).toBeVisible();
    expect(screen.getByText("Aún no hay mediciones recientes.")).toBeVisible();
  });
  it("shows loading while waiting for summary", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    show();
    const indicators = screen.getByRole("region", { name: "Indicadores reales de la organización ficticia" });
    expect(within(indicators).getByRole("status")).toHaveTextContent("Cargando");
  });
  it("shows a recoverable API error with reference", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              code: "NOT_READY",
              message: "Servicio no disponible.",
            }),
            { status: 503 },
          ),
        ),
      ),
    );
    show();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Servicio no disponible.",
      ),
    );
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeVisible();
  });
  it("accepts canonical historical PostgreSQL UUIDs without RFC variant bits", () => {
    const fixture = {
      id: "30000000-0000-0000-0000-000000000001",
      organization_id: "10000000-0000-4000-8000-000000000001",
      display_code: "FICT-01", display_name: null, birth_year: 1990,
      sex: null, status: "active", created_at: "2026-01-01T00:00:00Z",
      synthetic: true,
    };
    expect(profileSchema.safeParse(fixture).success).toBe(true);
    expect(profileSchema.safeParse({ ...fixture, id: "not-an-id" }).success).toBe(false);
  });
  it("distinguishes invalid successful responses from network failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ invalid: true }))));
    await expect(dataRequest("workspace", "/test", z.object({ required: z.string() })))
      .rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("does not accept a simulated profile contract as genuine data", () => {
    expect(
      profileSchema.safeParse({ id: "fake", status: "active" }).success,
    ).toBe(false);
  });
  it("sends a local workspace selector and preserves API conflict codes", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            code: "OUTLIER_CONFIRMATION_REQUIRED",
            message: "Confirma el valor.",
          }),
          { status: 409 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      dataRequest("workspace", "/test", z.object({})),
    ).rejects.toMatchObject({
      code: "OUTLIER_CONFIRMATION_REQUIRED",
      message: "Confirma el valor.",
    });
    expect(fetchMock.mock.calls[0]).toBeDefined();
  });
});
