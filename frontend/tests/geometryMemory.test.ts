import { BufferAttribute, BufferGeometry, Float32BufferAttribute } from "three";
import { describe, expect, it } from "vitest";
import { estimateRetainedGeometryMemory } from "../src/features/viewer/geometryMemory";

describe("bounded anatomical geometry accounting", () => {
  it("reports an empty geometry set without invented usage", () => {
    expect(estimateRetainedGeometryMemory([])).toEqual({
      retainedGeometryCount: 0, cpuGeometryBytes: 0,
    });
  });

  it("deduplicates repeated meshes, indices and shared attribute buffers", () => {
    const geometry = new BufferGeometry();
    const position = new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3);
    geometry.setAttribute("position", position);
    geometry.setAttribute("normal", new BufferAttribute(position.array, 3));
    geometry.setIndex([0, 1, 2]);
    const result = estimateRetainedGeometryMemory([geometry, geometry]);
    expect(result.retainedGeometryCount).toBe(1);
    expect(result.cpuGeometryBytes).toBe(position.array.buffer.byteLength
      + (geometry.getIndex()?.array.buffer.byteLength ?? 0));
    geometry.dispose();
  });

  it("counts both retained high and low LOD copies, then drops released ones", () => {
    const high = new BufferGeometry().setAttribute("position", new Float32BufferAttribute(new Float32Array(300), 3));
    const low = new BufferGeometry().setAttribute("position", new Float32BufferAttribute(new Float32Array(60), 3));
    expect(estimateRetainedGeometryMemory([high, low]).cpuGeometryBytes).toBe(1440);
    expect(estimateRetainedGeometryMemory([low]).cpuGeometryBytes).toBe(240);
    high.dispose(); low.dispose();
  });

  it("includes morph targets without duplicating repeated geometry references", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0], 3));
    geometry.morphAttributes.position = [new Float32BufferAttribute([1, 0, 0], 3)];
    const result = estimateRetainedGeometryMemory([geometry, geometry]);
    expect(result.cpuGeometryBytes).toBe(24);
    geometry.dispose();
  });
});
