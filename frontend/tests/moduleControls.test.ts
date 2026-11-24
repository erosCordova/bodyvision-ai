import { describe, expect, it } from "vitest";
import { csvPreview } from "../src/features/foundation/ModuleControls";
import type { Measurement } from "../src/services/api/records";

describe("visible report CSV",()=>{
  it("quotes cells, keeps numeric values and prevents spreadsheet formula execution",()=>{
    const row = { measured_at:"2026-11-24T01:00:00Z",metric_code:"weight",value:72,
      unit:"kg",method:"manual",responsible:' =HYPERLINK("example")',data_type:"OBSERVADO" } as Measurement;
    const csv=csvPreview([row]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"72","kg"');
    expect(csv).toContain('"\' =HYPERLINK(""example"")"');
    expect(csv.split("\r\n")).toHaveLength(2);
  });
});
