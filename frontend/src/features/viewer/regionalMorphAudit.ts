import { bodyVisualScenario } from "./bodyVolume";
import { frontDepthBias, regionalSoftTissueWeights, SOFT_TISSUE_REGIONS } from "./softTissueProfile";

/**
 * CPU mirror of the skin shader's regional scaling factors, measured at each
 * region's plateau (centerline, anterior face). The bars describe the visual
 * mesh transformation relative to the current reference, NOT body fat,
 * anthropometry or predicted circumferences.
 */
export const REGIONAL_MORPH_LABELS = {
  abdomen: "Abdomen", hips: "Caderas", chest: "Pecho",
  thighs: "Muslos", calves: "Pantorrillas",
} as const;

const MIN_GPU_SCALE = 0.60;
const MAX_GPU_SCALE = 1.40;
const clampGpu = (value: number) => Math.max(MIN_GPU_SCALE, Math.min(MAX_GPU_SCALE, value));
const roundPercent = (factor: number) => Math.round((factor - 1) * 1000) / 10;

export function regionalMorphAudit(referenceKg: number, variationPercent: number) {
  const visual = bodyVisualScenario(referenceKg, variationPercent);
  const front = frontDepthBias(0.1);
  return SOFT_TISSUE_REGIONS.map(region => {
    const heightFraction = (region.rise[1] + region.fall[0]) / 2;
    const weights = regionalSoftTissueWeights(heightFraction, 0);
    const side = (radial: number) => clampGpu(1 + radial * weights.side);
    const depth = (radial: number) => clampGpu(1 + radial * weights.depth * front);
    const scenarioSide = side(visual.scenarioRadialVariation);
    const scenarioDepth = depth(visual.scenarioRadialVariation);
    const originalSide = side(visual.referenceRadialVariation);
    const originalDepth = depth(visual.referenceRadialVariation);
    const sideRaw = 1 + visual.scenarioRadialVariation * weights.side;
    const depthRaw = 1 + visual.scenarioRadialVariation * weights.depth * front;
    return {
      id: region.id,
      label: REGIONAL_MORPH_LABELS[region.id],
      lateralPercent: roundPercent(scenarioSide / originalSide),
      frontPercent: roundPercent(scenarioDepth / originalDepth),
      limited: sideRaw < MIN_GPU_SCALE || sideRaw > MAX_GPU_SCALE
        || depthRaw < MIN_GPU_SCALE || depthRaw > MAX_GPU_SCALE,
    };
  });
}

/** A visual bar width only. The artificial scale is not a medical threshold. */
export function regionalAuditBarWidth(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.round(Math.abs(percent) / 25 * 100));
}
