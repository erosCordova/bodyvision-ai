/**
 * Illustrative weight/shape controls. None of the calculations are a clinical
 * estimate of body composition or a patient-specific anatomical prediction.
 */
export const DEFAULT_REFERENCE_KG = 70;
export const MIN_REFERENCE_KG = 40;
export const MAX_REFERENCE_KG = 200;
export const MIN_WEIGHT_VARIATION = -30;
export const MAX_WEIGHT_VARIATION = 30;

export function clampFinite(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function bodyVolumeScenario(referenceKg: number, variationPercent: number) {
  const base = clampFinite(referenceKg, MIN_REFERENCE_KG, MAX_REFERENCE_KG, DEFAULT_REFERENCE_KG);
  const variation = clampFinite(variationPercent, MIN_WEIGHT_VARIATION, MAX_WEIGHT_VARIATION, 0);
  const multiplier = 1 + variation / 100;
  // For a fixed-height illustration, a change in cross-section scales its
  // radius by sqrt(multiplier). This does NOT predict actual fat distribution.
  const radialVariation = Math.sqrt(multiplier) - 1;
  return {
    referenceKg: base,
    variationPercent: variation,
    simulatedKg: Math.round(base * multiplier * 10) / 10,
    radialVariation,
  };
}
