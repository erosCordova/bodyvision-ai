/**
 * UI-only latency feedback for one local synthetic pose inference.
 * These are engineering hints, not a validated device benchmark or a clinical score.
 */
export function formatLocalPoseDuration(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "No disponible";
  if (elapsedMs < 1000) return `${Math.round(elapsedMs)} ms`;
  return `${(elapsedMs / 1000).toFixed(2).replace(".", ",")} s`;
}

export function localPoseLatencyGuidance(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return "No fue posible medir la duración de esta ejecución.";
  }
  if (elapsedMs > 5000) {
    return "La ejecución local tardó más de cinco segundos. En dispositivos lentos, utiliza una fotografía ficticia más pequeña o repite la prueba.";
  }
  if (elapsedMs > 2000) {
    return "La ejecución local tardó más de dos segundos. Comprueba el rendimiento en el dispositivo objetivo.";
  }
  return "Duración registrada para esta prueba local; no representa un promedio entre dispositivos.";
}
