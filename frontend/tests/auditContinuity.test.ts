import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compareAuditContinuity } from "../src/features/access/auditBundle";
import { auditBytes, auditFixture, AUDIT_ORG } from "./fixtures/auditBundle";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());

function prefix(bundle: ReturnType<typeof auditFixture>, count: number) {
  return { ...bundle, events: bundle.events.slice(0, count), checkpoint_sequence: count,
    checkpoint_hash: bundle.events[count - 1]?.event_hash ?? "0".repeat(64) };
}

describe("audit continuity against separately retained historical export", () => {
  it("checks a valid append-only extension and an identical head", async () => {
    const current = auditFixture(4);
    const previous = prefix(current, 2);
    await expect(compareAuditContinuity(auditBytes(previous), auditBytes(current), AUDIT_ORG))
      .resolves.toEqual({ previous: 2, current: 4, added: 2 });
    await expect(compareAuditContinuity(auditBytes(current), auditBytes(current), AUDIT_ORG))
      .resolves.toEqual({ previous: 4, current: 4, added: 0 });
  });
  it("rejects a shorter valid chain, a fully rewritten valid chain and an empty reference", async () => {
    const current = auditFixture(4);
    await expect(compareAuditContinuity(auditBytes(current), auditBytes(prefix(current, 2)), AUDIT_ORG))
      .rejects.toThrow(/longitud/);
    await expect(compareAuditContinuity(auditBytes(prefix(current, 2)), auditBytes(auditFixture(4)), AUDIT_ORG))
      .rejects.toThrow(/punto de control/);
    await expect(compareAuditContinuity(auditBytes(prefix(current, 0)), auditBytes(current), AUDIT_ORG))
      .rejects.toThrow(/vacía/);
  });
  it("rejects wrong organization and corrupted bytes before accepting continuity", async () => {
    const current = auditFixture(3);
    const older = prefix(current, 1);
    await expect(compareAuditContinuity(auditBytes(older), auditBytes(current),
      "20000000-0000-4000-8000-000000000002")).rejects.toThrow(/alcance/);
    current.events[2].payload += " ";
    await expect(compareAuditContinuity(auditBytes(older), auditBytes(current), AUDIT_ORG))
      .rejects.toThrow(/inconsistencia/);
  });
});
