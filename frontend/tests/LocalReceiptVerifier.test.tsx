import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalReceiptVerifier } from "../src/features/analytics/LocalReceiptVerifier";
import { verifyLocalReportReceipt } from "../src/features/analytics/verifyReportReceipt";

vi.mock("../src/features/analytics/verifyReportReceipt", () => ({
  verifyLocalReportReceipt: vi.fn(),
}));

afterEach(() => vi.resetAllMocks());

describe("local saved report receipt controls", () => {
  it("requires all three independent files and never requires a fresh export", async () => {
    vi.mocked(verifyLocalReportReceipt).mockResolvedValue(undefined);
    render(<LocalReceiptVerifier/>);
    const details = screen.getByText("Verificar firma de un informe guardado").closest("details")!;
    details.open = true;
    const button = screen.getByRole("button", { name: "Verificar firma Ed25519" });
    expect(button).toBeDisabled();
    const report = new File(["fictional"], "report.pdf");
    const receipt = new File(["{}"], "receipt.json");
    const key = new File([new Uint8Array(32)], "public.key");
    fireEvent.change(screen.getByLabelText("Informe guardado (PDF o CSV)"), { target: { files: [report] } });
    fireEvent.change(screen.getByLabelText("Comprobante de firma (JSON)"), { target: { files: [receipt] } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Clave pública de confianza (32 bytes)"), { target: { files: [key] } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(/Firma Ed25519 verificada/)).toBeInTheDocument());
    expect(verifyLocalReportReceipt).toHaveBeenCalledWith(report, receipt, key);
    fireEvent.change(screen.getByLabelText("Clave pública de confianza (32 bytes)"), { target: { files: [] } });
    expect(screen.queryByText(/Firma Ed25519 verificada/)).not.toBeInTheDocument();
    expect(button).toBeDisabled();
  });
});
