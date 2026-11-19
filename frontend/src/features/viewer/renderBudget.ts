/** Pixel budgets constrain GPU fill-rate while keeping the SAME anatomical meshes. */
export type AtlasQuality = "alta" | "fluida";
export function preferredAtlasQuality(viewportWidth: number, coarsePointer = false, memoryGb?: number): AtlasQuality {
  return viewportWidth <= 760 || coarsePointer || (memoryGb !== undefined && memoryGb <= 4)
    ? "fluida" : "alta";
}
/** Upper bounds are target pixel budgets, not measured performance or FPS. */
export function atlasPixelRatio(width: number, height: number, devicePixelRatio: number, quality: AtlasQuality): number {
  const maximumRatio = quality === "alta" ? 1.7 : 1;
  const budget = quality === "alta" ? 2_500_000 : 950_000;
  const dimension = Number.isFinite(width * height) && width > 0 && height > 0
    ? width * height : 1;
  const requested = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.max(0.25, Math.min(maximumRatio, requested, Math.sqrt(budget / dimension)));
}
