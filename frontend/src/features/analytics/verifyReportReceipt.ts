import { reportReceiptSchema, type ReportReceipt } from "./reportReceipt";

type LocalFile = Pick<File, "name" | "size" | "arrayBuffer">;
const PDF_LIMIT = 16 * 1024 * 1024;
const CSV_LIMIT = 8 * 1024 * 1024;
const RECEIPT_LIMIT = 8192;
const KEY_SIZE = 32;

async function readBounded(file: LocalFile, limit: number): Promise<ArrayBuffer> {
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > limit)
    throw new Error("El archivo está vacío o supera el límite permitido.");
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== file.size)
    throw new Error("La lectura local del archivo es incompleta.");
  return bytes;
}

function parseReceipt(bytes: ArrayBuffer): ReportReceipt {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  // The v1 receipt contains only flat ASCII fields and unescaped values.
  // Reject escape sequences and duplicate keys rather than accepting
  // JSON.parse's last-wins interpretation. Pretty-printing is allowed.
  if (Array.from(text).some(character => {
    const code = character.codePointAt(0)!;
    return code === 92 || (code < 32 && code !== 9 && code !== 10 && code !== 13) || code > 126;
  }))
    throw new Error("El comprobante contiene caracteres no autorizados.");
  const keys = Array.from(text.matchAll(/"([a-z_]+)"\s*:/g), match => match[1]);
  const parsed = reportReceiptSchema.parse(JSON.parse(text));
  if (keys.length !== Object.keys(parsed).length || new Set(keys).size !== keys.length)
    throw new Error("El comprobante tiene campos duplicados o ambiguos.");
  const expectedName = parsed.format === "pdf"
    ? "bodyvision-" + parsed.export_id + ".pdf"
    : "bodyvision-historial-" + parsed.export_id + ".csv";
  if (parsed.filename !== expectedName || parsed.export_id !== parsed.export_id.toLowerCase()
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(parsed.generated_at)
    || !Number.isFinite(Date.parse(parsed.generated_at))
    || new Date(parsed.generated_at).toISOString().slice(0, 23) !== parsed.generated_at.slice(0, 23)
    || (parsed.format === "pdf" && parsed.row_count !== null)
    || (parsed.format === "csv" && (parsed.row_count === null
      || parsed.row_count > CSV_LIMIT || parsed.byte_count > CSV_LIMIT))) {
    throw new Error("Los metadatos del comprobante no son válidos.");
  }
  return parsed;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Verify only with a public key supplied from an independent trust channel.
 * No API call, browser persistence, or fallback to an embedded/untrusted key.
 */
export async function verifyLocalReportReceipt(
  reportFile: LocalFile,
  receiptFile: LocalFile,
  publicKeyFile: LocalFile,
): Promise<void> {
  const parsed = parseReceipt(await readBounded(receiptFile, RECEIPT_LIMIT));
  const trustedKey = await readBounded(publicKeyFile, KEY_SIZE);
  if (trustedKey.byteLength !== KEY_SIZE)
    throw new Error("La clave pública Ed25519 debe contener exactamente 32 bytes.");
  if (reportFile.name !== parsed.filename || reportFile.size !== parsed.byte_count)
    throw new Error("El archivo no corresponde al nombre o tamaño firmado.");
  const content = await readBounded(reportFile, parsed.format === "pdf" ? PDF_LIMIT : CSV_LIMIT);
  if (!globalThis.crypto?.subtle)
    throw new Error("Este navegador no dispone de verificación criptográfica local.");
  const subtle = globalThis.crypto.subtle;
  if (hex(await subtle.digest("SHA-256", trustedKey)) !== parsed.key_id)
    throw new Error("La clave pública de confianza no corresponde al comprobante.");
  if (hex(await subtle.digest("SHA-256", content)) !== parsed.sha256)
    throw new Error("La huella del archivo no coincide con el comprobante firmado.");
  const { signature, ...metadata } = parsed;
  const canonical = JSON.stringify(Object.fromEntries(
    Object.entries(metadata).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
  ));
  const signatureBytes = Uint8Array.from(signature.match(/.{2}/g)!, pair => parseInt(pair, 16));
  let valid: boolean;
  try {
    const key = await subtle.importKey("raw", trustedKey, { name: "Ed25519" }, false, ["verify"]);
    valid = await subtle.verify("Ed25519", key, signatureBytes, new TextEncoder().encode(canonical));
  } catch {
    throw new Error("No se pudo verificar Ed25519 en este navegador.");
  }
  if (!valid) throw new Error("La firma criptográfica del comprobante no es válida.");
}
