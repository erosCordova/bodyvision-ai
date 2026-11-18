import { describe, expect, it } from "vitest";
import { anatomyMeshName, anatomyNameKey } from "../src/features/viewer/anatomyNames";
describe("anatomical catalogue names", () => {
  it("uses glTF source names to find a structure after loader sanitization", () => {
    const source = anatomyMeshName({ name: "Femurl001", userData: { name: "Femur.l.001" } });
    expect(anatomyNameKey(source)).toBe(anatomyNameKey("Femur.l"));
    expect(anatomyNameKey(source)).not.toBe(anatomyNameKey("Femur.r"));
  });
  it("keeps the ordinary object name when upstream metadata is missing", () => {
    expect(anatomyMeshName({ name: "Clavicle.r", userData: {} })).toBe("Clavicle.r");
    expect(anatomyNameKey("Muscle_name.l.002")).toBe(anatomyNameKey("Muscle name.l"));
  });
});
