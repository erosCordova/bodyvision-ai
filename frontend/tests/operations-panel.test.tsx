import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationsPanel } from "../src/features/access/OperationsPanel";
import type { OperationsStatus } from "../src/services/api/operations";

const token = "t".repeat(48);
const status: OperationsStatus = {
  scope: "current_organization_current_process",
  checked_at: "2026-11-20T23:00:00Z", uptime_seconds: 500,
  window_seconds: 300, sample_limit: 256, sample_count: 5,
  successes: 3, client_errors: 1, server_errors: 1, query_interruptions: 1, p95_ms: 3010,
  database: { state: "ready", checked_at: "2026-11-20T23:00:00Z" },
  retention: { state: "disabled", checked_at: null },
  alerts: ["query_interrupted", "slow_responses"],
};
const json = (value: unknown, code = 200) => new Response(JSON.stringify(value), {
  status: code, headers: { "Content-Type": "application/json" },
});
afterEach(() => vi.unstubAllGlobals());

describe("administrator service operations", () => {
  it("loads only on request, showing real incidents and sample limits", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(status));
    vi.stubGlobal("fetch", fetcher);
    render(<OperationsPanel token={token}/>);
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Consultar estado del servicio" }));
    await screen.findByText("Requiere atención");
    expect(screen.getByText("Una consulta se interrumpió o agotó el tiempo de espera permitido.")).toBeVisible();
    expect(screen.getByText("Disponible y con esquema vigente")).toBeVisible();
    expect(screen.getByText(/Hasta 256 respuestas autenticadas/)).toBeVisible();
    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/auth/operations");
    expect(init.cache).toBe("no-store");
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${token}` });
    expect(document.body.textContent).not.toContain(token);
  });
  it("removes the last snapshot on failure and allows a clean retry", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(status))
      .mockResolvedValueOnce(json({}, 500)).mockResolvedValueOnce(json(status));
    vi.stubGlobal("fetch", fetcher);
    render(<OperationsPanel token={token}/>);
    const refresh = screen.getByRole("button", { name: "Consultar estado del servicio" });
    fireEvent.click(refresh); await screen.findByText("Requiere atención");
    fireEvent.click(refresh); await screen.findByRole("alert");
    expect(screen.queryByText("Disponible y con esquema vigente")).not.toBeInTheDocument();
    fireEvent.click(refresh); await screen.findByText("Disponible y con esquema vigente");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("discards a late result after changing session", async () => {
    let complete!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise<Response>(resolve => { complete = resolve; })));
    const { rerender } = render(<OperationsPanel token={token}/>);
    fireEvent.click(screen.getByRole("button", { name: "Consultar estado del servicio" }));
    rerender(<OperationsPanel token={"n".repeat(48)}/>);
    await act(async () => { complete(json(status)); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Consultar estado del servicio" })).toBeEnabled());
    expect(screen.queryByText("Requiere atención")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("does not present missing data as a measured zero latency", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ ...status, sample_count: 0,
      successes: 0, client_errors: 0, server_errors: 0, query_interruptions: 0, p95_ms: null, alerts: [],
    })));
    render(<OperationsPanel token={token}/>);
    fireEvent.click(screen.getByRole("button", { name: "Consultar estado del servicio" }));
    await screen.findByText("Sin muestras recientes");
    expect(screen.getByText("Sin muestras", { exact: true })).toBeVisible();
    expect(screen.queryByText("0 ms")).not.toBeInTheDocument();
  });
  it("reveals only explicitly sampled, bounded expired synthetic captures", async () => {
    const inventory = {
      scope: "current_organization_accessible_profiles_only",
      checked_at: "2026-11-21T15:00:00Z", expired_count: 1,
      count_capped: false, display_limit: 1000,
      oldest_expired_at: "2026-11-20T15:00:00Z", purge_executed: false,
    };
    const fetcher = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(json(url.endsWith("/captures/retention-inventory")
        ? inventory : status)));
    vi.stubGlobal("fetch", fetcher);
    render(<OperationsPanel token={token}/>);
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Comprobar capturas vencidas" }));
    await screen.findByText("1 captura vencida visible");
    expect(screen.getByText(/exclusivamente expedientes/)).toBeVisible();
    expect(screen.getByText(/No se ha ejecutado ninguna purga/)).toBeVisible();
    expect(screen.getByText(/no toda la organización/)).toBeVisible();
    expect(fetcher.mock.calls[0][0]).toBe(
      "/api/v1/auth/captures/retention-inventory",
    );
    expect((fetcher.mock.calls[0][1] as RequestInit).headers)
      .toMatchObject({ Authorization: `Bearer ${token}` });
    expect(document.body.textContent).not.toContain(token);
  });
  it("cannot present a capped inventory as a complete or global count", async () => {
    const sample = {
      scope: "current_organization_accessible_profiles_only",
      checked_at: "2026-11-21T15:00:00Z", expired_count: 1000,
      count_capped: true, display_limit: 1000,
      oldest_expired_at: "2026-11-01T15:00:00Z", purge_executed: false,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(sample)));
    render(<OperationsPanel token={token}/>);
    fireEvent.click(screen.getByRole("button", { name: "Comprobar capturas vencidas" }));
    await screen.findByText("Al menos 1000 capturas vencidas visibles");
    expect(screen.getByText(/podrían existir más/)).toBeVisible();
  });

});
