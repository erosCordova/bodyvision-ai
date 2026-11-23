import { webcrypto } from "node:crypto";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuditExportPanel } from "../src/features/access/AuditExportPanel";
import { verifyAuditBytes } from "../src/features/access/auditBundle";
import { downloadAudit } from "../src/services/api/auditExport";
import { AUDIT_EXPORT, AUDIT_ORG, auditBytes } from "./fixtures/auditBundle";

vi.mock("../src/services/api/auditExport", () => ({ downloadAudit: vi.fn() }));
const api = vi.mocked(downloadAudit);
const token = "t".repeat(43);
const createUrl = vi.fn(() => "blob:audit-fixture");
beforeEach(() => {
  api.mockReset(); createUrl.mockClear();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("URL", { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function prepared() {
  const bytes = auditBytes();
  return { summary: await verifyAuditBytes(bytes), filename: `bodyvision-audit-${AUDIT_EXPORT}.json`,
    blob: new Blob([bytes.buffer], { type: "application/json" }) };
}

it("muestra la confirmación y un fallo sin iniciar descargas parciales", async () => {
  api.mockResolvedValueOnce(await prepared()).mockRejectedValueOnce(new Error("La cadena no es íntegra"));
  render(<AuditExportPanel token={token} organizationId={AUDIT_ORG} identityKey="admin-a" />);
  fireEvent.click(screen.getByRole("button", { name: "Descargar auditoría verificable" }));
  expect(await screen.findByRole("status")).toHaveTextContent("2 eventos comprobados");
  expect(createUrl).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Descargar auditoría verificable" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("no es íntegra");
  expect(createUrl).toHaveBeenCalledOnce();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("cancela una descarga pendiente al cambiar de identidad", async () => {
  const result = await prepared();
  let finish!: (value: typeof result) => void;
  const pending = new Promise<typeof result>(resolve => { finish = resolve; });
  api.mockReturnValueOnce(pending);
  const view = render(<AuditExportPanel token={token} organizationId={AUDIT_ORG} identityKey="admin-a" />);
  fireEvent.click(screen.getByRole("button", { name: "Descargar auditoría verificable" }));
  const signal = api.mock.calls[0][2];
  view.rerender(<AuditExportPanel token={"n".repeat(43)} organizationId={AUDIT_ORG} identityKey="admin-b" />);
  await act(async () => { finish(result); await pending; });
  expect(signal.aborted).toBe(true);
  expect(createUrl).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("conserva la descarga pendiente cuando se renueva el token de la misma identidad", async () => {
  const result = await prepared();
  let finish!: (value: typeof result) => void;
  const pending = new Promise<typeof result>(resolve => { finish = resolve; });
  api.mockReturnValueOnce(pending);
  const view = render(<AuditExportPanel token={token} organizationId={AUDIT_ORG} identityKey="admin-a" />);
  fireEvent.click(screen.getByRole("button", { name: "Descargar auditoría verificable" }));
  const signal = api.mock.calls[0][2];
  view.rerender(<AuditExportPanel token={"n".repeat(43)} organizationId={AUDIT_ORG} identityKey="admin-a" />);
  await act(async () => { finish(result); await pending; });
  expect(signal.aborted).toBe(false);
  expect(createUrl).toHaveBeenCalledOnce();
  expect(screen.getByRole("status")).toHaveTextContent("2 eventos comprobados");
});

it("verifica un archivo elegido sin consultar la API", async () => {
  const bytes = auditBytes();
  const file = new File([bytes.buffer], "audit.json", { type: "application/json" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
  render(<AuditExportPanel token={token} organizationId={AUDIT_ORG} identityKey="admin-a" />);
  fireEvent.change(screen.getByLabelText("Verificar un archivo de auditoría"), { target: { files: [file] } });
  expect(await screen.findByRole("status")).toHaveTextContent("2 eventos con coherencia interna verificada");
  expect(api).not.toHaveBeenCalled(); expect(createUrl).not.toHaveBeenCalled();
});
