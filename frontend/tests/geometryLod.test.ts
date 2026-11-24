import { describe, expect, it } from "vitest";
import { Float32BufferAttribute, SphereGeometry } from "three";
import { SimplifyModifier } from "three/addons/modifiers/SimplifyModifier.js";
import {
  eligibleForGeometryLod,
  isUsefulLod,
  lodVerticesToRemove,
  triangleCount,
  shouldPrepareGeometryLod,
} from "../src/features/viewer/geometryLod";

describe("conservative anatomical geometry LOD", () => {
  it("defers costly simplification while the parent anatomical layer is hidden", () => {
    expect(shouldPrepareGeometryLod(true, false, true, true)).toBe(false);
    expect(shouldPrepareGeometryLod(true, true, false, true)).toBe(false);
    expect(shouldPrepareGeometryLod(true, true, true, false)).toBe(false);
    expect(shouldPrepareGeometryLod(false, true, true, true)).toBe(false);
    expect(shouldPrepareGeometryLod(true, true, true, true)).toBe(true);
  });

  it("keeps small and multi-material structures in their original detail", () => {
    const small = new SphereGeometry(1, 12, 8);
    expect(eligibleForGeometryLod(small)).toBe(false);
    expect(lodVerticesToRemove(small)).toBe(0);
    small.dispose();

    const grouped = new SphereGeometry(1, 80, 64);
    grouped.clearGroups();
    grouped.addGroup(0, 600, 0);
    grouped.addGroup(600, grouped.getIndex()!.count - 600, 1);
    expect(eligibleForGeometryLod(grouped)).toBe(false);
    grouped.dispose();
  });

  it("does not simplify animated morph geometry and keeps all source data", () => {
    const source = new SphereGeometry(1, 80, 64);
    source.morphAttributes.position = [
      new Float32BufferAttribute(new Float32Array(source.getAttribute("position").count * 3), 3),
    ];
    expect(eligibleForGeometryLod(source)).toBe(false);
    source.dispose();
  });

  it("uses meshoptimizer to reduce real triangles while retaining normals, UVs and original mesh", async () => {
    const original = new SphereGeometry(1, 80, 64);
    const before = triangleCount(original);
    const positions = original.getAttribute("position").count;
    expect(eligibleForGeometryLod(original)).toBe(true);
    const simplified = await new SimplifyModifier().modify(original, lodVerticesToRemove(original));
    expect(isUsefulLod(original, simplified)).toBe(true);
    expect(triangleCount(simplified)).toBeLessThan(before * 0.9);
    expect(simplified.getAttribute("normal")).toBeDefined();
    expect(simplified.getAttribute("uv")).toBeDefined();
    expect(original.getAttribute("position").count).toBe(positions);
    expect(triangleCount(original)).toBe(before);
    simplified.dispose();
    original.dispose();
  }, 30000);
});
