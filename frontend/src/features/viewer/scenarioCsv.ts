/**
 * Narrow allowlist for exporting visible synthetic scenarios only.
 * Never serialize arbitrary notes, patient names, actor or profile IDs.
 * The API already enforces authorization; this local CSV is not an export
 * of observed measurements. The complete-history collector additionally
 * checks authorization, page consistency, profile isolation and a hard cap.
 */
import type { SimulationScenario } from "../../services/api/records";

export const MAX_SCENARIO_CSV_ROWS = 2000;

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
const zonedScenarioDateTime = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:[0-5]\d)$/;

/**
 * A local-time string may yield different "fecha_utc" values in different
 * browsers. Only unambiguous zoned instants with a real calendar day are
 * suitable for an immutable synthetic provenance export.
 */
function scenarioUtcDateTime(raw: string): string {
  if (typeof raw !== "string") throw new Error("La fecha del escenario es inválida.");
  const parts = zonedScenarioDateTime.exec(raw);
  if (!parts) throw new Error("La fecha del escenario debe incluir hora y zona horaria.");
  const calendarDay = `${parts[1]}-${parts[2]}-${parts[3]}`;
  const calendar = new Date(`${calendarDay}T00:00:00Z`);
  // Date.parse may silently roll invalid days (e.g. February 30) into March.
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== calendarDay)
    throw new Error("La fecha del escenario no existe en el calendario.");
  const zone = /([+-])(\d{2}):(\d{2})$/.exec(raw);
  if (zone) {
    const hours = Number(zone[2]);
    const minutes = Number(zone[3]);
    if (hours > 14 || (hours === 14 && minutes !== 0))
      throw new Error("La zona horaria del escenario no es válida.");
  }
  const instant = new Date(raw);
  if (!Number.isFinite(instant.getTime()))
    throw new Error("La fecha del escenario es inválida.");
  return instant.toISOString();
}

export function buildSyntheticScenarioCsv(rows: readonly SimulationScenario[]): string {
  if (rows.length === 0 || rows.length > MAX_SCENARIO_CSV_ROWS) {
    throw new Error("La exportación debe contener una página sintética no vacía.");
  }
  const records = rows.map(row => {
    if (row.data_type !== "SIMULADO") {
      throw new Error("Los datos observados nunca forman parte de este CSV.");
    }
    const normalizedUtc = scenarioUtcDateTime(row.created_at);
    return [
      "SIMULADO",
      numberCell(row.version, 1, 100000, true),
      numberCell(row.reference_kg, 40, 200),
      numberCell(row.variation_percent, -30, 30, true),
      numberCell(row.simulated_kg, 0, 300),
      numberCell(row.stature_cm, 145, 205, true),
      normalizedUtc,
      revisionCell(row.model_revision, /^[a-f0-9]{40}$/),
      revisionCell(row.algorithm_revision, /^[a-z0-9._-]{1,64}$/),
    ].join(";");
  });
  // UTF-8 BOM helps spreadsheet software retain accents; all fields are
  // allowlisted numbers, enum, ISO date or safe revisions. No formula inputs.
  return "\uFEFF" + [csvColumns.join(";"), ...records].join("\r\n") + "\r\n";
}
