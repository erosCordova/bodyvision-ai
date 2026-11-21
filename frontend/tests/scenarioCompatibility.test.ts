import { describe, expect, it } from "vitest";
import { scenarioCompatibilityReason } from "../src/features/viewer/scenarioCompatibility";
import { anatomyRevision } from "../src/features/viewer/atlasSource";
import { SOFT_TISSUE_PROFILE_VERSION } from "../src/features/viewer/softTissueProfile";

describe("historical 3D scenario provenance checks", () => {
  const current = {
    data_type: "SIMULADO" as const,
    model_revision: anatomyRevision,
    algorithm_revision: SOFT_TISSUE_PROFILE_VERSION,
  };
  it("permits replay when both pinned versions match the synthetic record", () => {
    expect(scenarioCompatibilityReason(current)).toBeNull();
  });
  it("rejects an older atlas but retains that row for read-only history", () => {
    expect(scenarioCompatibilityReason({ ...current, model_revision: "0".repeat(40) }))
      .toContain("modelo anatómico");
  });
  it("rejects algorithm drift even when the 3D atlas is identical", () => {
    expect(scenarioCompatibilityReason({ ...current, algorithm_revision: "regional-soft-tissue-v1" }))
      .toContain("algoritmo visual");
  });
  it("rejects non-synthetic measurements and missing provenance", () => {
    expect(scenarioCompatibilityReason({ ...current, data_type: "OBSERVADO" as "SIMULADO" }))
      .toContain("SIMULADO");
    expect(scenarioCompatibilityReason({ ...current, model_revision: "" }))
      .toContain("modelo anatómico");
  });
});
