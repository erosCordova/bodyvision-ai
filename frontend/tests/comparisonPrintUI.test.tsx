import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeasurementComparison } from "../src/features/analytics/MeasurementComparison";
import type { Measurement } from "../src/services/api/records";

const profileId = "11111111-1111-4111-8111-111111111111";
const common: Measurement = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  profile_id: profileId, metric_code: "weight", value: 70,
  unit: "kg", measured_at: "2026-10-01T14:00:00Z",
  method: "manual", instrument: null, notes: null, created_by: profileId,
  responsible: "Personal de prueba", created_at: "2026-10-01T14:00:00Z",
  supersedes_id: null, correction_reason: null, is_current: true,
  outlier_confirmed: false, data_type: "OBSERVADO",
};
const later: Measurement = {
  ...common, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  measured_at: "2026-11-12T14:00:00Z", value: 77,
};
const props = {
  profileId, profileCode: "DEMO-001", metricCode: "weight",
  metricLabel: "Peso", unit: "kg", synthetic: true,
  rows: [later, common],
};
let callbacks: FrameRequestCallback[] = [];

beforeEach(() => {
  callbacks = [];
  vi.spyOn(window, "print").mockImplementation(() => {});
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("traceable synthetic PDF print flow", () => {
  it("requires a valid comparison and prints only a synthetic snapshot", async () => {
    render(<MeasurementComparison {...props}/>);
    const button = screen.getByRole("button", { name: "Preparar informe PDF" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(screen.getByText("Comparación de mediciones")).toBeInTheDocument();
    expect(screen.getByText("DATOS FICTICIOS · NO APTO PARA USO CLÍNICO"))
      .toBeInTheDocument();
    expect(screen.getByText(common.id)).toBeInTheDocument();
    expect(screen.getByText(later.id)).toBeInTheDocument();
    await act(async () => { callbacks.forEach(callback => callback(0)); });
    expect(window.print).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event("afterprint")); });
    expect(screen.queryByText("DATOS FICTICIOS · NO APTO PARA USO CLÍNICO"))
      .not.toBeInTheDocument();
  });

  it("blocks a non-synthetic profile without opening the print dialog", () => {
    render(<MeasurementComparison {...props} synthetic={false}/>);
    expect(screen.getByRole("button", { name: "Preparar informe PDF" }))
      .toBeDisabled();
    expect(window.print).not.toHaveBeenCalled();
  });

  it("does not export a comparison when fewer than two records are present", () => {
    render(<MeasurementComparison {...props} rows={[common]}/>);
    expect(screen.getByText("Se necesitan al menos dos mediciones para comparar fechas."))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preparar informe PDF" }))
      .not.toBeInTheDocument();
  });
});
