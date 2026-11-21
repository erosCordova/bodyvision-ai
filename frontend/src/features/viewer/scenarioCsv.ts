/**
 * Narrow allowlist for exporting visible synthetic scenarios only.
 * Never serialize arbitrary notes, patient names, actor or profile IDs.
 * The API already enforces authorization; this local CSV is not an export
 * of observed measurements, and is intentionally limited to a single page.
 */
import type { SimulationScenario } from "../../services/api/records";

const csvColumns = [
  "tipo_dato", "version", "peso_referencia_kg", "variacion_porcentaje",
  "peso_simulado_kg", "estatura_cm", "fecha_utc", "version_modelo",
  "version_algoritmo",
] as const;

function numberCell(value: number, min: number, max: number, integer = false): string {
  if (!Number.isFinite(value) || value < min || value > max ||
      (integer && !Number.isSafeInteger(value))) {
    throw new Error("El escenario tiene un valor numérico no válido.");
  }
  return String(value);
}
function revisionCell(value: string, pattern: RegExp): string {
  if (!pattern.test(value)) throw new Error("La versión del escenario no es válida.");
  return value;
}
export function buildSyntheticScenarioCsv(rows: readonly SimulationScenario[]): string {
  if (rows.length === 0 || rows.length > 100) {
    throw new Error("La exportación debe contener una página sintética no vacía.");
  }
  const records = rows.map(row => {
    if (row.data_type !== "SIMULADO") {
      throw new Error("Los datos observados nunca forman parte de este CSV.");
    }
    const date = new Date(row.created_at);
    if (!Number.isFinite(date.getTime())) {
      throw new Error("La fecha del escenario es inválida.");
    }
    return [
      "SIMULADO",
      numberCell(row.version, 1, 100000, true),
      numberCell(row.reference_kg, 40, 200),
      numberCell(row.variation_percent, -30, 30, true),
      numberCell(row.simulated_kg, 0, 300),
      numberCell(row.stature_cm, 145, 205, true),
      date.toISOString(),
      revisionCell(row.model_revision, /^[a-f0-9]{40}$/),
      revisionCell(row.algorithm_revision, /^[a-z0-9._-]{1,64}$/),
    ].join(";");
  });
  // UTF-8 BOM helps spreadsheet software retain accents; all fields are
  // allowlisted numbers, enum, ISO date or safe revisions. No formula inputs.
  return "\uFEFF" + [csvColumns.join(";"), ...records].join("\r\n") + "\r\n";
}
