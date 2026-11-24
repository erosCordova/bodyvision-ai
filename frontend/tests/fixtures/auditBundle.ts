import { createHash, randomUUID } from "node:crypto";

export const AUDIT_ORG = "10000000-0000-4000-8000-000000000001";
export const AUDIT_EXPORT = "a1000000-0000-4000-8000-000000000001";
export function auditFixture(count = 2) {
  let prior = "0".repeat(64);
  const events: { sequence: number; previous_hash: string; event_hash: string; payload: string }[] = [];
  for (let position = 1; position <= count; position += 1) {
    const payload = JSON.stringify([
      "bodyvision-audit-v1", position, prior, randomUUID(), AUDIT_ORG, null,
      randomUUID(), "test.acción", "audit", null, "allowed", "1795380000.123456",
    ]);
    const digest = createHash("sha256").update(payload).digest("hex");
    events.push({ sequence: position, previous_hash: prior, event_hash: digest, payload });
    prior = digest;
  }
  return {
    version: 1, algorithm: "sha256-chain-v1", scope: "synthetic-organization-audit",
    organization_id: AUDIT_ORG, export_id: AUDIT_EXPORT, generated_at: "2026-11-22T19:00:00-05:00",
    checkpoint_sequence: count, checkpoint_hash: prior, external_anchor: false, events,
  };
}
export const auditBytes = (value = auditFixture()) => new TextEncoder().encode(JSON.stringify(value));
