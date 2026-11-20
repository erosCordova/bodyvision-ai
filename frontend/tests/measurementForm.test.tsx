import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MeasurementForm } from "../src/features/measurements/MeasurementForm";
import type { Measurement, Metric } from "../src/services/api/records";

const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../src/app/providers/WorkspaceProvider", () => ({
  useWorkspace: () => ({ id: "synthetic-workspace", api: { save }, readOnly: false }),
}));
vi.mock("../src/components/ui/Modal", () => ({
  Modal: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
}));

const metric: Metric = {
  code: "weight", label: "Peso", unit: "kg", min_value: 1, max_value: 500,
  allowed_methods: ["manual", "device"], precision: 2, instructions: "Datos ficticios.",
};
const observation: Measurement = {
  id: "10000000-0000-4000-8000-000000000011",
  profile_id: "10000000-0000-4000-8000-000000000012",
  metric_code: "weight", value: 72, unit: "kg", measured_at: "2026-10-01T03:04:56.789123Z",
  method: "manual", instrument: null, notes: null,
  created_by: "10000000-0000-4000-8000-000000000013",
  responsible: "Operador ficticio", created_at: "2026-10-01T04:00:00Z",
  supersedes_id: null, correction_reason: null, is_current: true,
  outlier_confirmed: false, data_type: "OBSERVADO",
};

function show(correction?: Measurement) {
  const onSaved = vi.fn();
  render(<QueryClientProvider client={new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })}>
    <MeasurementForm profileId={observation.profile_id} metrics={[metric]}
      correction={correction} onClose={vi.fn()} onSaved={onSaved} />
  </QueryClientProvider>);
  return onSaved;
}

beforeEach(() => { save.mockReset().mockResolvedValue(observation); });

describe("observed measurement correction time", () => {
  it.each([
    "2026-10-01T03:04:56.789123Z",
    "2026-09-30T22:04:56.789123-05:00",
  ])("retains the exact original timestamp when editing only the value: %s", async measured_at => {
    const done = show({ ...observation, measured_at });
    expect(screen.getByLabelText("Fecha y hora (Lima)")).toHaveValue("2026-09-30T22:04");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Valor (kg)" }), { target: { value: "71" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Motivo de la corrección" }), {
      target: { value: "Corrección ficticia del valor" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar corrección" }));
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith(observation.profile_id, expect.objectContaining({
      value: 71, measured_at, correction_reason: "Corrección ficticia del valor",
    }), expect.any(String), observation.id);
  });

  it("uses the explicitly changed Lima date instead of the original timestamp", async () => {
    const done = show(observation);
    fireEvent.change(screen.getByLabelText("Fecha y hora (Lima)"), {
      target: { value: "2026-10-02T10:20" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Motivo de la corrección" }), {
      target: { value: "Corregir fecha ficticia" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar corrección" }));
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][1].measured_at).toBe("2026-10-02T10:20:00-05:00");
  });

  it("keeps minute-based input for a new observation", async () => {
    const done = show();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Valor (kg)" }), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText("Fecha y hora (Lima)"), {
      target: { value: "2026-10-02T10:20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar medición" }));
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][1].measured_at).toBe("2026-10-02T10:20:00-05:00");
    expect(save.mock.calls[0][3]).toBeUndefined();
  });
});
