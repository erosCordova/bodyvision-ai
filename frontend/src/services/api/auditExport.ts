import { withPrivateSession } from "./privateSessionRequest";
import { MAX_AUDIT_BYTES, verifyAuditBytes } from "../../features/access/auditBundle";

export async function downloadAudit(token: string, organizationId: string, signal: AbortSignal) {
  const response = await withPrivateSession(token, bearer => fetch("/api/v1/auth/audit/export", {
    method: "POST", credentials: "same-origin", cache: "no-store", signal,
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: "{}",
  }), signal);
  if (!response.ok) {
    if (response.status === 413) throw new Error("La auditoría supera 10.000 eventos u 8 MiB; no se entrega un archivo parcial.");
    if (response.status === 409) throw new Error("La auditoría no es íntegra; se bloqueó la exportación.");
    if (response.status === 403) throw new Error("Solo un administrador puede exportar la auditoría.");
    throw new Error("No se pudo descargar la auditoría.");
  }
  const declared = response.headers.get("Content-Length");
  if ((declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_AUDIT_BYTES))
    || !response.headers.get("Content-Type")?.startsWith("application/json"))
    throw new Error("La descarga no tiene un tamaño o formato válido.");
  const expectedHash = response.headers.get("X-Content-SHA256");
  const filename = response.headers.get("Content-Disposition")?.match(/^attachment; filename="(bodyvision-audit-[a-f0-9-]{36}\.json)"$/)?.[1];
  if (!filename || !expectedHash || !/^[0-9a-f]{64}$/.test(expectedHash) || !response.body)
    throw new Error("Faltan los datos de verificación de la descarga.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_AUDIT_BYTES) {
        await reader.cancel();
        throw new Error("La descarga supera 8 MiB.");
      }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  signal.throwIfAborted();
  if (declared && Number(declared) !== size) throw new Error("La descarga está incompleta.");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const summary = await verifyAuditBytes(bytes, organizationId);
  signal.throwIfAborted();
  if (summary.sha256 !== expectedHash || filename !== `bodyvision-audit-${summary.exportId}.json`)
    throw new Error("El archivo no coincide con la exportación verificada.");
  return { summary, filename, blob: new Blob([bytes.buffer], { type: "application/json" }) };
}
