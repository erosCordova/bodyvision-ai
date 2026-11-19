/**
 * Illustrative stature scale for the one anatomical atlas model.
 * An isotropic body prediction cannot be inferred from height and weight.
 * This scaling only stretches the atlas vertically, including its layers.
 */
export const BASELINE_HEIGHT_CM = 175;
export const MIN_HEIGHT_CM = 145;
export const MAX_HEIGHT_CM = 205;

export function clampStature(value: number): number {
  if (!Number.isFinite(value)) return BASELINE_HEIGHT_CM;
  return Math.max(MIN_HEIGHT_CM, Math.min(MAX_HEIGHT_CM, value));
}

export function heightScale(centimeters: number): number {
  return clampStature(centimeters) / BASELINE_HEIGHT_CM;
}
