import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_AUDIT_BYTES, verifyAuditBytes } from "../src/features/access/auditBundle";
import { downloadAudit } from "../src/services/api/auditExport";
import { registerPrivateSessionRefresh } from "../src/services/api/sessionInvalidation";
import { AUDIT_EXPORT, AUDIT_ORG, auditBytes, auditFixture } from "./fixtures/auditBundle";

beforeEach(() => { vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("auditoría portátil", () => {
  it("comprueba UTF-8, todos los eventos y la cadena vacía", async () => {
    const summary = await verifyAuditBytes(auditBytes(), AUDIT_ORG);
    expect(summary.sequence).toBe(2);
    expect((await verifyAuditBytes(auditBytes(auditFixture(0)))).hash).toBe("0".repeat(64));
  });
  it.each(["payload", "order", "tail", "head", "scope", "extra"])("rechaza alteración %s", async kind => {
    const value = auditFixture();
    if (kind === "payload") value.events[0].payload += " ";
    if (kind === "order") value.events.reverse();
    if (kind === "tail") value.events.pop();
    if (kind === "head") value.checkpoint_hash = "f".repeat(64);
    if (kind === "scope") value.organization_id = "20000000-0000-4000-8000-000000000002";
    if (kind === "extra") Object.assign(value, { patient_name: "No permitido" });
    await expect(verifyAuditBytes(auditBytes(value))).rejects.toThrow();
  });
  it("no confunde JSON malformado con una cadena verificable", async () => {
    const value = auditFixture(1);
    value.events[0].payload = "not-json";
    value.events[0].event_hash = createHash("sha256").update("not-json").digest("hex");
    value.checkpoint_hash = value.events[0].event_hash;
    await expect(verifyAuditBytes(auditBytes(value))).rejects.toThrow("formato inválido");
  });
});

function response(bytes = auditBytes(), headers: Record<string, string> = {}) {
  return new Response(bytes, { headers: {
    "Content-Type": "application/json", "Content-Length": String(bytes.length),
    "Content-Disposition": `attachment; filename="bodyvision-audit-${AUDIT_EXPORT}.json"`,
    "X-Content-SHA256": createHash("sha256").update(bytes).digest("hex"), ...headers,
  } });
}
const token = "t".repeat(43);
describe("entrega de auditoría", () => {
  it("renueva una sola vez antes de reintentar una exportación rechazada por sesión", async () => {
    const replacement = "n".repeat(43);
    const renew = vi.fn(async () => replacement);
    const unregister = registerPrivateSessionRefresh(renew);
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(response());
    vi.stubGlobal("fetch", fetcher);
    try {
      expect((await downloadAudit(token, AUDIT_ORG, new AbortController().signal)).summary.sequence).toBe(2);
      expect(renew).toHaveBeenCalledExactlyOnceWith(token);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls.map(call => call[1].headers.Authorization))
        .toEqual([`Bearer ${token}`, `Bearer ${replacement}`]);
    } finally { unregister(); }
  });
  it("exige el hash de entrega y la organización actual antes de producir el Blob", async () => {
    const fetcher = vi.fn(async () => response()); vi.stubGlobal("fetch", fetcher);
    const downloaded = await downloadAudit(token, AUDIT_ORG, new AbortController().signal);
    expect(downloaded.blob.type).toBe("application/json");
    expect(downloaded.summary.sequence).toBe(2);
    expect(downloaded.filename).toBe(`bodyvision-audit-${AUDIT_EXPORT}.json`);
    await expect(downloadAudit(token, "20000000-0000-4000-8000-000000000002", new AbortController().signal))
      .rejects.toThrow("alcance");
  });
  it.each(["hash", "filename", "length"])("rechaza una descarga con %s alterado", async kind => {
    const changed: Record<string, string> = kind === "hash" ? { "X-Content-SHA256": "f".repeat(64) }
      : kind === "filename" ? { "Content-Disposition": 'attachment; filename="../audit.json"' }
      : { "Content-Length": "1" };
    vi.stubGlobal("fetch", vi.fn(async () => response(auditBytes(), changed)));
    await expect(downloadAudit(token, AUDIT_ORG, new AbortController().signal)).rejects.toThrow();
  });
  it("acota los bytes leídos aunque el servidor no declare su longitud", async () => {
    const large = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(MAX_AUDIT_BYTES + 1)); controller.close();
    } }), { headers: {
      "Content-Type": "application/json", "Content-Disposition": `attachment; filename="bodyvision-audit-${AUDIT_EXPORT}.json"`,
      "X-Content-SHA256": "0".repeat(64),
    } });
    vi.stubGlobal("fetch", vi.fn(async () => large));
    await expect(downloadAudit(token, AUDIT_ORG, new AbortController().signal)).rejects.toThrow("8 MiB");
  });
  it("no entrega un resultado cuando la sesión ya se canceló", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response()));
    const controller = new AbortController(); controller.abort();
    await expect(downloadAudit(token, AUDIT_ORG, controller.signal)).rejects.toThrow();
  });
});
