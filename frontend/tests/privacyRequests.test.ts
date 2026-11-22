import { describe, expect, it } from "vitest";
import { kindLabels, privacyRequestSchema } from "../src/services/api/privacyRequests";

const record = {
  id: "11111111-1111-4111-8111-111111111111",
  profile_id: "22222222-2222-4222-8222-222222222222",
  request_type: "access",
  status: "received",
  requested_by: "33333333-3333-4333-8333-333333333333",
  received_at: "2026-11-22T13:00:00Z",
  review_target_at: "2026-11-29T13:00:00Z",
  review_started_at: null,
  reviewed_by: null,
  profile_code: "BV-FAKE123",
};

describe("solicitudes ARCO ficticias", () => {
  it("acepta los cinco tipos sin añadir datos personales libres", () => {
    expect(Object.keys(kindLabels)).toHaveLength(5);
    for (const request_type of Object.keys(kindLabels)) {
      expect(privacyRequestSchema.parse({ ...record, request_type }).request_type)
        .toBe(request_type);
    }
  });
  it("rechaza estados de cumplimiento no implementados y claves extra", () => {
    expect(privacyRequestSchema.safeParse({ ...record, status: "completed" }).success).toBe(false);
    expect(privacyRequestSchema.safeParse({ ...record, notes: "identidad privada" }).success).toBe(false);
    expect(privacyRequestSchema.safeParse({ ...record, request_type: "medical_diagnosis" }).success)
      .toBe(false);
  });
});
