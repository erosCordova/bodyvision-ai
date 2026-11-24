/**
 * Illustrative historical reference for the LEFT pass of the exact same 3D
 * mesh. Not a reconstructed body, clinical forecast, or observed measurement.
 */
import { bodyVisualScenario, bodyVolumeScenario } from "./bodyVolume";
import { clampStature, heightScale } from "./bodyStature";

export type HistoricalComparisonControls = {
  referenceKg: number;
  variationPercent: number;
  statureCm: number;
};

export function buildHistoricalComparisonShape(controls: HistoricalComparisonControls) {
  const body = bodyVolumeScenario(controls.referenceKg, controls.variationPercent);
  const visual = bodyVisualScenario(controls.referenceKg, controls.variationPercent);
  return {
    radialVariation: visual.scenarioRadialVariation,
    statureScale: heightScale(controls.statureCm),
    simulatedKg: body.simulatedKg,
    statureCm: clampStature(controls.statureCm),
  };
}

/**
 * Mapping of the shader's y-bound uniforms from the current body pose to
 * another stature on the SAME mesh. The atlas is centered at the world origin
 * and scales solely along Y, so both endpoints transform by the identical
 * root.scale.y ratio. This also ensures normalized region heights stay
 * coherent when left and right passes use different stature values.
 */
export function remapHeightBounds(
  minY: number, maxY: number, currentScaleY: number, referenceScaleY: number,
): { minY: number; maxY: number } {
  if (![minY, maxY, currentScaleY, referenceScaleY].every(Number.isFinite) ||
      currentScaleY <= 0 || referenceScaleY <= 0 || minY > maxY) {
    throw new Error("Invalid comparison 3D bounds");
  }
  const ratio = referenceScaleY / currentScaleY;
  return { minY: minY * ratio, maxY: maxY * ratio };
}
