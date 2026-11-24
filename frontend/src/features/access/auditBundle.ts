import { z } from "zod";

export const MAX_AUDIT_BYTES = 8 * 1024 * 1024;
export const MAX_AUDIT_EVENTS = 10000;
const uuid = z.string().regex(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const sequence = z.number().int().min(0).max(MAX_AUDIT_EVENTS);
const payloadSchema = z.tuple([
  z.literal("bodyvision-audit-v1"), sequence, hash, uuid, uuid, uuid.nullable(), uuid,
  z.string().min(1).max(100), z.string().min(1).max(60), uuid.nullable(),
  z.enum(["allowed", "denied", "error"]), z.string().regex(/^-?\d{1,20}(?:\.\d{1,6})?$/),
]);
const bundleSchema = z.object({
  version: z.literal(1), algorithm: z.literal("sha256-chain-v1"),
  scope: z.literal("synthetic-organization-audit"), organization_id: uuid, export_id: uuid,
  generated_at: z.string().datetime({ offset: true }), checkpoint_sequence: sequence,
  checkpoint_hash: hash, external_anchor: z.literal(false),
  events: z.array(z.object({
    sequence, previous_hash: hash, event_hash: hash, payload: z.string().max(2048),
  }).strict()).max(MAX_AUDIT_EVENTS),
}).strict();
export type AuditFileSummary = Readonly<{
  organizationId: string; exportId: string; sequence: number; hash: string; sha256: string;
}>;

export async function auditBytesHash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
}

/** Hashes prove internal consistency; a separately trusted head is still required for authorship. */
export async function verifyAuditBytes(
  bytes: Uint8Array<ArrayBuffer>, expectedOrganization?: string,
  trustedPrior?: Pick<AuditFileSummary, "organizationId" | "sequence" | "hash">,
): Promise<AuditFileSummary> {
  if (bytes.length < 1 || bytes.length > MAX_AUDIT_BYTES)
    throw new Error("El archivo está vacío o supera 8 MiB.");
  let bundle: z.infer<typeof bundleSchema>;
  try {
    bundle = bundleSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch { throw new Error("El archivo no tiene el formato de auditoría esperado."); }
  if ((expectedOrganization && bundle.organization_id !== expectedOrganization)
    || bundle.events.length !== bundle.checkpoint_sequence)
    throw new Error("El alcance o el número de eventos de la auditoría no coincide.");
  if (trustedPrior && (trustedPrior.organizationId !== bundle.organization_id
    || !Number.isSafeInteger(trustedPrior.sequence) || trustedPrior.sequence < 1
    || !/^[0-9a-f]{64}$/.test(trustedPrior.hash)
    || trustedPrior.sequence > bundle.checkpoint_sequence))
    throw new Error("La auditoría actual no conserva el alcance o la longitud de la referencia anterior.");
  let prior = "0".repeat(64);
  // Batches keep CPU/crypto work bounded without starting 10,000 operations at once.
  for (let offset = 0; offset < bundle.events.length; offset += 50) {
    const rows = bundle.events.slice(offset, offset + 50);
    const digests = await Promise.all(rows.map(row => auditBytesHash(new TextEncoder().encode(row.payload))));
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index], position = offset + index + 1;
      let decoded: unknown;
      try { decoded = JSON.parse(row.payload); }
      catch { throw new Error("La cadena contiene un evento con formato inválido."); }
      const payload = payloadSchema.safeParse(decoded);
      if (!payload.success || row.sequence !== position || row.previous_hash !== prior
        || row.event_hash !== digests[index] || payload.data[1] !== position
        || payload.data[2] !== prior || payload.data[4] !== bundle.organization_id)
        throw new Error("La cadena de auditoría tiene una inconsistencia.");
      prior = row.event_hash;
      if (trustedPrior?.sequence === position && trustedPrior.hash !== prior)
        throw new Error("La cadena actual no conserva el punto de control anterior.");
    }
  }
  if (prior !== bundle.checkpoint_hash)
    throw new Error("El punto final de la auditoría no coincide.");
  return {
    organizationId: bundle.organization_id, exportId: bundle.export_id,
    sequence: bundle.checkpoint_sequence, hash: bundle.checkpoint_hash,
    sha256: await auditBytesHash(bytes),
  };
}

/** The older export must have been retained independently and trusted by the
 * operator. Matching its prefix detects history changes, not authorship.
 */
export async function compareAuditContinuity(
  older: Uint8Array<ArrayBuffer>, newer: Uint8Array<ArrayBuffer>, organizationId: string,
): Promise<{ previous: number; current: number; added: number }> {
  const previous = await verifyAuditBytes(older, organizationId);
  if (previous.sequence === 0)
    throw new Error("La referencia anterior vacía no demuestra continuidad.");
  const current = await verifyAuditBytes(newer, organizationId, previous);
  return { previous: previous.sequence, current: current.sequence,
    added: current.sequence - previous.sequence };
}
