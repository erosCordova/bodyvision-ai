import { describe, expect, it } from "vitest";
import { anatomyDisplayName, anatomyMeshName, anatomyNameKey } from "../src/features/viewer/anatomyNames";
describe("anatomical catalogue names", () => {
  it("uses glTF source names to find a structure after loader sanitization", () => {
    const source = anatomyMeshName({ name: "Femurl001", userData: { name: "Femur.l.001" } });
    expect(anatomyNameKey(source)).toBe(anatomyNameKey("Femur.l"));
    expect(anatomyNameKey(source)).not.toBe(anatomyNameKey("Femur.r"));
  });
  it("renders common structures in Spanish without modifying the 3D source key", () => {
    expect(anatomyDisplayName("Femur.l.001")).toBe("Fémur izquierdo");
    expect(anatomyDisplayName("Femur.r")).toBe("Fémur derecho");
    expect(anatomyDisplayName("Biceps brachii")).toBe("Bíceps braquial");
    expect(anatomyDisplayName("Common carotid artery")).toBe("Arteria carótida común");
    expect(anatomyNameKey("Femur.l.001")).toBe(anatomyNameKey("Femur.l"));
  });
  it("does not invent translations for other or similarly prefixed structures", () => {
    expect(anatomyDisplayName("Femur variant")).toBe("Femur variant");
    expect(anatomyDisplayName("Unknown_structure.r.002")).toBe("Unknown structure.r");
  });
  it("keeps the ordinary object name when upstream metadata is missing", () => {
    expect(anatomyMeshName({ name: "Clavicle.r", userData: {} })).toBe("Clavicle.r");
    expect(anatomyNameKey("Muscle_name.l.002")).toBe(anatomyNameKey("Muscle name.l"));
  });
});
