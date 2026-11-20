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
