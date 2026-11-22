import { createHash, webcrypto } from "node:crypto";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeasurementComparison } from "../src/features/analytics/MeasurementComparison";
import { LongitudinalSummary } from "../src/features/analytics/LongitudinalSummary";
import type { Measurement } from "../src/services/api/records";

const profileId = "11111111-1111-4111-8111-111111111111";
const initial: Measurement = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  profile_id: profileId, metric_code: "weight", value: 70,
  unit: "kg", measured_at: "2026-11-01T10:00:00Z",
  method: "manual", instrument: null, notes: null, created_by: profileId,
  responsible: "Operador ficticio", created_at: "2026-11-01T10:00:00Z",
  supersedes_id: null, correction_reason: null, is_current: true,
  outlier_confirmed: false, data_type: "OBSERVADO",
};
const latest: Measurement = {
  ...initial, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  measured_at: "2026-11-02T10:00:00Z", value: 72,
};
const rows = [initial, latest];
const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const pdf = "%PDF-1.4\nsynthetic comparison\n%%EOF\n";
const csv = "source_measurement_id,measured_at_utc,metric_code,value,unit,method,outlier_confirmed\r\n"
  + `${initial.id},2026-11-01T10:00:00Z,weight,70,kg,manual,false\r\n`
  + `${latest.id},2026-11-02T10:00:00Z,weight,72,kg,manual,false\r\n`;
const sha = (content: string) => createHash("sha256").update(content).digest("hex");
const pdfName = `bodyvision-${id}.pdf`;
const csvName = `bodyvision-historial-${id}.csv`;

const comparisonReport = {
  report_id: id, filename: pdfName, generated_at: "2026-11-22T10:00:00Z",
  pdf_base64: btoa(pdf), sha256: sha(pdf),
};
const longitudinalReport = {
  export_id: id, filename: csvName, generated_at: "2026-11-22T10:00:00Z",
  metric_code: "weight", period: "all" as const, row_count: 2,
  csv_base64: btoa(csv), sha256: sha(csv),
};

function savedFile(name: string, data: string): File {
  const file = new File([data], name);
  // Jsdom File in Node lacks Blob.arrayBuffer; provide the browser interface.
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => Uint8Array.from(new TextEncoder().encode(data)).buffer,
  });
  return file;
}

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true, value: vi.fn(() => "blob:bodyvision-test"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("private report download followed by explicit saved-copy verification", () => {
  it("verifies the chosen PDF bytes and clears the proof when the selection changes", async () => {
    const exportReport = vi.fn().mockResolvedValue(comparisonReport);
    const props = {
      rows, unit: "kg", profileId, profileCode: "TEST-001", synthetic: true,
      metricCode: "weight", metricLabel: "Peso", exportReport,
    };
    const view = render(<MeasurementComparison {...props} />);
    expect(screen.queryByText("Verificar PDF guardado")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Descargar informe PDF" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Verificar PDF guardado" }))
      .toBeInTheDocument());
    const chosen = screen.getByLabelText("Seleccionar PDF descargado para verificar");
    fireEvent.change(chosen, { target: { files: [savedFile(pdfName, pdf)] } });
    await waitFor(() => expect(screen.getByRole("status"))
      .toHaveTextContent("Copia PDF verificada"));
    view.rerender(<MeasurementComparison {...props} profileId="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" />);
    await waitFor(() => expect(screen.queryByText("Verificar PDF guardado"))
      .not.toBeInTheDocument());
  });

  it("detects a changed saved PDF without uploading it", async () => {
    render(<MeasurementComparison rows={rows} unit="kg" profileId={profileId}
      profileCode="TEST-001" synthetic metricCode="weight" metricLabel="Peso"
      exportReport={vi.fn().mockResolvedValue(comparisonReport)} />);
    fireEvent.click(screen.getByRole("button", { name: "Descargar informe PDF" }));
    await waitFor(() => expect(screen.getByText("Verificar PDF guardado")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Seleccionar PDF descargado para verificar"),
      { target: { files: [savedFile(pdfName, pdf.replace("synthetic", "SYNTHETIC"))] } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("no coincide"));
  });

  it("checks the saved CSV by selecting the actual local file", async () => {
    const exportReport = vi.fn().mockResolvedValue(longitudinalReport);
    render(<LongitudinalSummary rows={rows} profileId={profileId} metricCode="weight"
      unit="kg" period="all" exportReport={exportReport} />);
    fireEvent.click(screen.getByRole("button", { name: "Descargar historial observado (CSV)" }));
    await waitFor(() => expect(screen.getByText("Verificar CSV guardado")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Seleccionar CSV descargado para verificar"),
      { target: { files: [savedFile(csvName, csv)] } });
    await waitFor(() => expect(screen.getByRole("status"))
      .toHaveTextContent("Copia CSV verificada"));
    expect(exportReport).toHaveBeenCalledTimes(1);
  });
});
