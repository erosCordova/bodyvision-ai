import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FAVORITES_LIMIT, FAVORITES_STORAGE_KEY,
  loadAtlasFavorites, saveAtlasFavorites,
} from "../src/features/viewer/anatomyFavorites";

describe("anatomical favorites remain local to a browser tab", () => {
  beforeEach(() => sessionStorage.clear());

  it("restores a bounded list of catalogue-only identifiers", () => {
    const entries = [
      { id: "Femur.l", layer: "skeleton" as const },
      { id: "Nervio-mediano", layer: "nerves" as const },
    ];
    saveAtlasFavorites(entries);
    expect(loadAtlasFavorites()).toEqual(entries);
    expect(sessionStorage.getItem(FAVORITES_STORAGE_KEY)).not.toContain("profile_id");
    saveAtlasFavorites([]);
    expect(sessionStorage.getItem(FAVORITES_STORAGE_KEY)).toBeNull();
  });

  it("fails closed for malformed, duplicate, oversized and unknown-layer data", () => {
    const invalid = [
      "[{}]", '{"patient":"x"}', "not-json",
      JSON.stringify([{ id: "femur", layer: "organs" }]),
      JSON.stringify([{ id: "femur", layer: "skin", patient_id: "secret" }]),
      JSON.stringify(Array(FAVORITES_LIMIT + 1).fill({ id: "femur", layer: "skin" })),
      JSON.stringify([{ id: "femur", layer: "skin" }, { id: "femur", layer: "skin" }]),
      "x".repeat(4097),
    ];
    invalid.forEach(raw => {
      sessionStorage.setItem(FAVORITES_STORAGE_KEY, raw);
      expect(loadAtlasFavorites()).toEqual([]);
    });
  });

  it("still works in memory if browser storage is blocked", () => {
    const getter = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw Error("denied"); });
    const setter = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("denied"); });
    expect(loadAtlasFavorites()).toEqual([]);
    expect(() => saveAtlasFavorites([{ id: "Femur", layer: "skeleton" }])).not.toThrow();
    getter.mockRestore();
    setter.mockRestore();
  });
});
