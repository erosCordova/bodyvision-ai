/**
 * BodyVision illustrative (not anatomical or clinical) soft-tissue profile.
 *
 * Coordinates: vertical position 0..1 from feet to head; lateral distance
 * expressed as a fraction of body height, measured from the atlas centerline.
 * The same source of truth generates the GLSL masks used by all mesh layers.
 */
export const SOFT_TISSUE_PROFILE_VERSION = "regional-soft-tissue-v2";

export const SOFT_TISSUE_REGIONS = [
  { id: "abdomen",    rise: [0.33, 0.44], fall: [0.60, 0.72], lateral: [0.12, 0.20], side: 1.00, depth: 1.12 },
  { id: "hips",       rise: [0.23, 0.34], fall: [0.44, 0.55], lateral: [0.11, 0.20], side: 0.84, depth: 0.86 },
  { id: "chest",      rise: [0.60, 0.68], fall: [0.75, 0.83], lateral: [0.13, 0.21], side: 0.46, depth: 0.54 },
  { id: "thighs",     rise: [0.15, 0.23], fall: [0.36, 0.46], lateral: [0.08, 0.17], side: 0.44, depth: 0.46 },
  { id: "calves",     rise: [0.08, 0.14], fall: [0.22, 0.31], lateral: [0.07, 0.15], side: 0.18, depth: 0.20 },
] as const;

/** GLSL-style smoothstep, used for CPU regression tests of the same profile. */
function smoothstep(start: number, end: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

export function regionalSoftTissueWeights(heightFraction: number, lateralFraction: number) {
  if (!Number.isFinite(heightFraction) || !Number.isFinite(lateralFraction)) {
    return { side: 0, depth: 0 };
  }
  let side = 0;
  let depth = 0;
  const x = Math.abs(lateralFraction);
  for (const region of SOFT_TISSUE_REGIONS) {
    const vertical = smoothstep(region.rise[0], region.rise[1], heightFraction)
      * (1 - smoothstep(region.fall[0], region.fall[1], heightFraction));
    const lateral = 1 - smoothstep(region.lateral[0], region.lateral[1], x);
    const weight = vertical * lateral;
    side = Math.max(side, weight * region.side);
    depth = Math.max(depth, weight * region.depth);
  }
  return { side, depth };
}

const glslFloat = (value: number) => value.toFixed(4);
/** Generated from the identical constants used in regionalSoftTissueWeights(). */
export const SOFT_TISSUE_PROFILE_GLSL = [
  "vec2 bvProfile(float h, float lateral) {",
  "  float bvSide = 0.0;",
  "  float bvDepth = 0.0;",
  ...SOFT_TISSUE_REGIONS.flatMap(region => {
    const [riseStart, riseEnd] = region.rise;
    const [fallStart, fallEnd] = region.fall;
    const [lateralStart, lateralEnd] = region.lateral;
    const mask = "bvRegion_" + region.id;
    return [
      `  float ${mask} = smoothstep(${glslFloat(riseStart)}, ${glslFloat(riseEnd)}, h)`
        + ` * (1.0 - smoothstep(${glslFloat(fallStart)}, ${glslFloat(fallEnd)}, h))`
        + ` * (1.0 - smoothstep(${glslFloat(lateralStart)}, ${glslFloat(lateralEnd)}, lateral));`,
      `  bvSide = max(bvSide, ${mask} * ${glslFloat(region.side)});`,
      `  bvDepth = max(bvDepth, ${mask} * ${glslFloat(region.depth)});`,
    ];
  }),
  "  return vec2(bvSide, bvDepth);",
  "}",
].join("\n");

/** Front/back weighting is deliberately subtle; +Z is the front atlas view. */
export function frontDepthBias(relativeDepth: number): number {
  if (!Number.isFinite(relativeDepth)) return 1;
  return 0.86 + 0.28 * smoothstep(-0.04, 0.055, relativeDepth);
}
