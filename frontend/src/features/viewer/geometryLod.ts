import type { BufferGeometry } from "three";

/**
 * Geometry LOD is intentionally conservative: keep authored seams, vertex
 * attributes, all selectable anatomical structure names, and the original mesh.
 * This runs only for static, indexed, sufficiently large meshes.
 */
export const LOD_MIN_TRIANGLES = 3000;
export const LOD_REMOVAL_FRACTION = 0.4;

export function triangleCount(geometry: BufferGeometry): number {
  const count = geometry.getIndex()?.count ?? geometry.getAttribute("position")?.count ?? 0;
  return Math.floor(count / 3);
}

export function eligibleForGeometryLod(geometry: BufferGeometry): boolean {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  return Boolean(
    position &&
    index &&
    position.count >= 1200 &&
    index.count >= LOD_MIN_TRIANGLES * 3 &&
    geometry.groups.length <= 1 &&
    !Object.values(geometry.morphAttributes).some(attributes => attributes.length > 0),
  );
}

export function lodVerticesToRemove(geometry: BufferGeometry): number {
  const count = geometry.getAttribute("position")?.count ?? 0;
  return eligibleForGeometryLod(geometry)
    ? Math.floor(count * LOD_REMOVAL_FRACTION)
    : 0;
}

/** Keep the original when an asset cannot be substantially simplified. */
export function isUsefulLod(original: BufferGeometry, simplified: BufferGeometry): boolean {
  return triangleCount(simplified) >= 1 &&
    triangleCount(simplified) <= triangleCount(original) * 0.9 &&
    !!simplified.getAttribute("position") &&
    !!simplified.getAttribute("normal") === !!original.getAttribute("normal") &&
    !!simplified.getAttribute("uv") === !!original.getAttribute("uv");
}
