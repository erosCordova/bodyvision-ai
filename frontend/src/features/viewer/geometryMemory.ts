import type { BufferAttribute, BufferGeometry, InterleavedBufferAttribute } from "three";

/**
 * Approximate CPU-side backing storage of currently retained geometry arrays.
 * Count shared ArrayBuffers only once, including those referenced by overlay
 * meshes, morph targets and both original / simplified LOD geometry.
 *
 * This is NOT measured GPU VRAM, heap usage, overall process memory or a
 * prediction of performance. It deliberately excludes images and textures.
 */
export function estimateRetainedGeometryMemory(geometries: Iterable<BufferGeometry>) {
  const seenGeometries = new Set<BufferGeometry>();
  const seenArrays = new Set<ArrayBufferLike>();
  let cpuGeometryBytes = 0;
  const count = (attribute: BufferAttribute | InterleavedBufferAttribute | undefined) => {
    if (!attribute) return;
    const source = "data" in attribute ? attribute.data.array : attribute.array;
    if (!ArrayBuffer.isView(source) || seenArrays.has(source.buffer)) return;
    seenArrays.add(source.buffer);
    cpuGeometryBytes += source.buffer.byteLength;
  };
  for (const geometry of geometries) {
    if (seenGeometries.has(geometry)) continue;
    seenGeometries.add(geometry);
    count(geometry.getIndex() ?? undefined);
    Object.values(geometry.attributes).forEach(attribute => count(attribute));
    Object.values(geometry.morphAttributes).forEach(attributes => attributes.forEach(attribute => count(attribute)));
  }
  return {
    retainedGeometryCount: seenGeometries.size,
    cpuGeometryBytes,
  };
}
