import { createHash, generateKeyPairSync, sign, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyLocalReportReceipt } from "../src/features/analytics/verifyReportReceipt";

const id = "11111111-1111-4111-8111-111111111111";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function localFile(name: string, bytes: Uint8Array) {
  return { name, size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer };
}

function signedFixture(format: "pdf" | "csv" = "pdf") {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const content = Buffer.from(format === "pdf" ? "%PDF-1.4\nfictional\n%%EOF" : "synthetic,csv\r\n");
  const filename = format === "pdf" ? "bodyvision-" + id + ".pdf" : "bodyvision-historial-" + id + ".csv";
  // Insertion order is the server's sorted canonical field order.
  const metadata = {
    algorithm: "Ed25519",
    byte_count: content.length,
    export_id: id,
    filename,
    format,
    generated_at: "2026-11-23T10:00:00.123456Z",
    key_id: sha(raw),
    row_count: format === "csv" ? 1 : null,
    scope: "synthetic-local-test-report",
    sha256: sha(content),
    version: 1,
  };
  const signature = sign(null, Buffer.from(JSON.stringify(metadata)), privateKey).toString("hex");
  const receipt = { ...metadata, signature };
  const keyFile = localFile("trusted.key", raw);
  const reportFile = localFile(filename, content);
  const receiptFile = (value: string = JSON.stringify(receipt, null, 2)) =>
    localFile(filename + ".receipt.json", Buffer.from(value));
  return { receipt, keyFile, reportFile, receiptFile, content };
}

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe("independent browser verification of detached signed fictional reports", () => {
  it.each(["pdf", "csv"] as const)("verifies a real Ed25519 %s signature", async format => {
    const f = signedFixture(format);
    await expect(verifyLocalReportReceipt(f.reportFile, f.receiptFile(), f.keyFile))
      .resolves.toBeUndefined();
  });

  it("rejects a substituted key, changed bytes and a forged signature", async () => {
    const f = signedFixture();
    await expect(verifyLocalReportReceipt(f.reportFile, f.receiptFile(), signedFixture().keyFile))
      .rejects.toThrow(/clave pública/);
    const changed = Buffer.from(f.content);
    changed[0] ^= 1;
    await expect(verifyLocalReportReceipt(
      localFile(f.reportFile.name, changed), f.receiptFile(), f.keyFile,
    )).rejects.toThrow(/huella/);
    await expect(verifyLocalReportReceipt(f.reportFile, f.receiptFile(JSON.stringify({
      ...f.receipt, generated_at: "2026-11-23T10:00:00.999999Z",
    })), f.keyFile)).rejects.toThrow(/firma/);
  });

  it("rejects duplicate fields, extra key metadata, invalid timestamps and oversize inputs", async () => {
    const f = signedFixture();
    const duplicate = JSON.stringify(f.receipt).slice(0, -1) + ',"version":1}';
    await expect(verifyLocalReportReceipt(f.reportFile, f.receiptFile(duplicate), f.keyFile))
      .rejects.toThrow(/duplicados/);
    await expect(verifyLocalReportReceipt(f.reportFile, f.receiptFile(JSON.stringify({
      ...f.receipt, public_key: "untrusted",
    })), f.keyFile)).rejects.toThrow();
    await expect(verifyLocalReportReceipt(f.reportFile, f.receiptFile(JSON.stringify({
      ...f.receipt, generated_at: "2026-02-30T10:00:00.123456Z",
    })), f.keyFile)).rejects.toThrow();
    const oversized = { name: "large.json", size: 8193, arrayBuffer: vi.fn() };
    await expect(verifyLocalReportReceipt(f.reportFile, oversized, f.keyFile))
      .rejects.toThrow(/límite/);
    expect(oversized.arrayBuffer).not.toHaveBeenCalled();
  });

  it("fails closed if the browser does not support Ed25519", async () => {
    const f = signedFixture();
    vi.stubGlobal("crypto", { subtle: {
      digest: webcrypto.subtle.digest.bind(webcrypto.subtle),
      importKey: vi.fn().mockRejectedValue(new Error("unsupported")),
    } });
    await expect(verifyLocalReportReceipt(f.reportFile, f.receiptFile(), f.keyFile))
      .rejects.toThrow(/Ed25519/);
  });
});
