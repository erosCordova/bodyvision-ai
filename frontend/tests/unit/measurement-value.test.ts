import { describe, expect, it } from "vitest";
import { parseMeasurementValue } from "../../src/features/measurements/MeasurementForm";

describe("entrada decimal de mediciones",()=>{
  it("acepta pesos completos y decimales",()=>{
    expect(parseMeasurementValue("80")).toBe(80);
    expect(parseMeasurementValue("80,50")).toBe(80.5);
    expect(parseMeasurementValue("120.25")).toBe(120.25);
    expect(parseMeasurementValue("500")).toBe(500);
    expect(parseMeasurementValue(80)).toBe(80);
  });
  it("rechaza vacío y formatos ambiguos",()=>{
    for(const value of [""," ","80,5.0","8e1","80 kg","80,","NaN"]) expect(parseMeasurementValue(value)).toBeNaN();
  });
});
