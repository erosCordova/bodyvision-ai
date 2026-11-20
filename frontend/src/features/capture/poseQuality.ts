import type { CaptureReview } from "./captureQuality";
import type { PoseEstimate, PosePoint } from "./poseInference";

/**
 * Visibility and capture conditions are heuristic review signals.
 * They are NOT confidence of correct identification, diagnostic accuracy or
 * evidence that all body parts are anatomically correct.
 */
export type PoseGroup = {
  id: string;
  label: string;
  landmarks: readonly number[];
  visible: number;
  total: number;
  state: "visible" | "partial" | "missing";
};
export type PoseQuality = {
  state: "not-detected" | "insufficient" | "caution" | "reviewable";
  label: string;
  visiblePoints: number;
  coreVisible: number;
  coreTotal: number;
  groups: PoseGroup[];
  warnings: string[];
};

export const POSE_REVIEW_GROUPS: ReadonlyArray<{
  id: string; label: string; landmarks: readonly number[];
}> = [
  { id: "head", label: "Rostro", landmarks: [0, 2, 5] },
  { id: "shoulders", label: "Hombros", landmarks: [11, 12] },
  { id: "elbows", label: "Codos", landmarks: [13, 14] },
  { id: "wrists", label: "Muñecas", landmarks: [15, 16] },
  { id: "hips", label: "Caderas", landmarks: [23, 24] },
  { id: "knees", label: "Rodillas", landmarks: [25, 26] },
  { id: "ankles", label: "Tobillos", landmarks: [27, 28] },
];
const CORE_GROUPS = ["shoulders", "hips", "knees", "ankles"];

export function clampVisibilityThreshold(value: number): number {
  return Number.isFinite(value) ? Math.min(0.9, Math.max(0.3, value)) : 0.5;
}

export function isPosePointVisible(point: PosePoint | undefined, threshold: number): boolean {
  return !!point &&
    Number.isFinite(point.x) && Number.isFinite(point.y) &&
    Number.isFinite(point.visibility) &&
    point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1 &&
    point.visibility >= clampVisibilityThreshold(threshold);
}

export function assessPoseQuality(
  pose: PoseEstimate,
  capture: CaptureReview,
  threshold = 0.5,
): PoseQuality {
  const visible = (index: number) =>
    pose.found && isPosePointVisible(pose.landmarks[index], threshold);
  const visiblePoints = pose.found
    ? pose.landmarks.filter(point => isPosePointVisible(point, threshold)).length : 0;

  const groups = POSE_REVIEW_GROUPS.map(group => {
    const count = group.landmarks.filter(visible).length;
    return {
      ...group,
      total: group.landmarks.length,
      visible: count,
      state: count === 0 ? "missing" as const :
        count === group.landmarks.length ? "visible" as const : "partial" as const,
    };
  });
  const core = groups.filter(group => CORE_GROUPS.includes(group.id));
  const coreVisible = core.reduce((total, group) => total + group.visible, 0);
  const coreTotal = core.reduce((total, group) => total + group.total, 0);
  // Degenerate coordinates can pass a visibility threshold even though the
  // entire core skeleton lies on one tiny patch of the image. This is a
  // synthetic review guard only, not an anatomical correctness measurement.
  const coreIndices = [11, 12, 23, 24, 25, 26, 27, 28];
  const corePoints = coreIndices.filter(visible).map(index => pose.landmarks[index]);
  const collapsedCore = corePoints.length === coreIndices.length &&
    Math.hypot(
      Math.max(...corePoints.map(point => point.x)) -
        Math.min(...corePoints.map(point => point.x)),
      Math.max(...corePoints.map(point => point.y)) -
        Math.min(...corePoints.map(point => point.y)),
    ) < 0.06;
  // Heuristic framing checks are evaluated only with all eight finite,
  // visible core joints. They do not verify anatomical correctness.
  const coreRows = [[11, 12], [23, 24], [25, 26], [27, 28]]
    .map(pair => pair.map(index => pose.landmarks[index]?.y ?? 0)
      .reduce((sum, value) => sum + value, 0) / 2);
  const fullCoreVisible = corePoints.length === coreIndices.length;
  const invertedCore = fullCoreVisible && coreRows.every((y, index) =>
    index === 0 || y < coreRows[index - 1] - 0.04);
  const nearFrameEdge = fullCoreVisible && corePoints.some(point =>
    point.x < 0.015 || point.x > 0.985 || point.y < 0.015 || point.y > 0.985);
  const compactFullBody = fullCoreVisible &&
    Math.max(...corePoints.map(point => point.y)) -
      Math.min(...corePoints.map(point => point.y)) < 0.18;
  const uncertainFraming = invertedCore || nearFrameEdge || compactFullBody;
  const warnings: string[] = [];
  if (!pose.found) {
    warnings.push("No se ha detectado una pose humana en esta imagen.");
  } else {
    if (coreVisible < coreTotal) {
      warnings.push("Faltan uno o más puntos clave en hombros, caderas, rodillas o tobillos.");
    }
    if (visiblePoints < 20) {
      warnings.push("Pocos puntos superan el umbral de visibilidad seleccionado.");
    }
    if (collapsedCore) {
      warnings.push("Los puntos clave aparecen casi superpuestos; la pose no permite una revisión visual fiable.");
    }
    if (invertedCore) {
      warnings.push("La orientación vertical de los puntos principales parece invertida; comprueba la imagen.");
    }
    if (nearFrameEdge) {
      warnings.push("Algunos puntos principales están muy cerca del borde; revisa posibles recortes.");
    }
    if (compactFullBody) {
      warnings.push("Los puntos del cuerpo ocupan poca altura de la imagen; prueba un encuadre más cercano.");
    }
  }
  for (const check of capture.checks.filter(check => !check.passed)) {
    warnings.push(check.detail);
  }
  let state: PoseQuality["state"];
  if (!pose.found) state = "not-detected";
  else if (coreVisible < 4 || visiblePoints < 12 || collapsedCore) state = "insufficient";
  else if (coreVisible < coreTotal || visiblePoints < 20 || !capture.passed || uncertainFraming) state = "caution";
  else state = "reviewable";
  const labels: Record<PoseQuality["state"], string> = {
    "not-detected": "Sin detección",
    insufficient: "Puntos insuficientes",
    caution: "Requiere revisión",
    reviewable: "Visible para revisión visual",
  };
  return {
    state, label: labels[state], visiblePoints, coreVisible,
    coreTotal, groups, warnings,
  };
}
