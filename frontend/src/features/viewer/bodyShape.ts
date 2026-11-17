export type BodyShape = { height: number; weight: number; definition: number };
export const initialShape: BodyShape = { height: 175, weight: 72, definition: 20 };
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
/** Artistic interpolation of a demo mesh. This is not a body reconstruction model. */
export function shapeInfluences(shape: BodyShape) {
  const weight = clamp(shape.weight, 45, 130);
  return {
    heightScale: clamp(shape.height, 145, 205) / 175,
    weights: [
      Math.max(0, (weight - 72) / 58) * 0.85,
      Math.max(0, (72 - weight) / 27) * 0.65,
      clamp(shape.definition, 0, 100) / 100 * 0.7,
    ],
  };
}
