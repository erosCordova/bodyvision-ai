/**
 * Warning for the sampled saturation of an artistic, locally rendered GPU
 * morph. Uses the SAME profile boundaries, radial equation and front/back
 * bias as the mesh shader. Does not estimate actual human morphology.
 */
import { bodyVisualScenario } from "./bodyVolume";
import {
  SOFT_TISSUE_REGIONS, regionalSoftTissueWeights, frontDepthBias,
} from "./softTissueProfile";

const GPU_SCALE_MIN = 0.60;
const GPU_SCALE_MAX = 1.40;

export function sampledMorphClamping(referenceKg: number, variationPercent: number) {
  const radial = bodyVisualScenario(referenceKg, variationPercent).scenarioRadialVariation;
  const regions: string[] = [];
  for (const region of SOFT_TISSUE_REGIONS) {
    const fraction = (region.rise[1] + region.fall[0]) / 2;
    const mask = regionalSoftTissueWeights(fraction, 0);
    const x = 1 + radial * mask.side;
    const depthFactors = [-0.1, 0.1].map(depth =>
      1 + radial * mask.depth * frontDepthBias(depth));
    if ([x, ...depthFactors].some(value =>
      value < GPU_SCALE_MIN || value > GPU_SCALE_MAX)) {
      regions.push(region.id);
    }
  }
  return { regions };
}
