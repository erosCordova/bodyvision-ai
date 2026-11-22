/** Bounded, fail-closed whole-history export for synthetic scenarios only.
 * No arbitrary notes, user identifiers, observed measurements or client
 * workspace headers are copied to CSV. Every page is fetched via the
 * already-authenticated scenarios API; permissions are rechecked by the API.
 */
import type { SimulationScenario } from "../../services/api/records";
import { buildSyntheticScenarioCsv, MAX_SCENARIO_CSV_ROWS } from "./scenarioCsv";

export type ScenarioHistoryPage = {
  items: SimulationScenario[];
  total: number;
  limit: number;
  offset: number;
};

type ExportOptions = {
  expectedProfileId: string;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
};

function assertActive(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("Exportación cancelada; no se generó ningún archivo.");
}

function assertCount(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Respuesta de paginación inválida: ${name}.`);
  }
}

/** All-or-nothing export: never download a partial or inconsistent history. */
export async function collectSyntheticScenarioHistoryCsv(
  readPage: (offset: number) => Promise<ScenarioHistoryPage>,
  { expectedProfileId, signal, onProgress }: ExportOptions,
): Promise<string> {
  if (!/^[a-f0-9-]{36}$/i.test(expectedProfileId)) {
    throw new Error("Selecciona un expediente ficticio válido.");
  }
  const rows: SimulationScenario[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  let pageSize: number | null = null;

  while (total === null || rows.length < total) {
    assertActive(signal);
    const offset = rows.length;
    const page = await readPage(offset);
    assertActive(signal);

    assertCount(page.total, "total");
    assertCount(page.offset, "offset");
    assertCount(page.limit, "limit");
    if (page.limit < 1 || page.limit > 100 || page.offset !== offset) {
      throw new Error("La API devolvió una página de escenarios inconsistente.");
    }
    if (total === null) {
      total = page.total;
      pageSize = page.limit;
      if (total === 0) throw new Error("El historial no contiene escenarios exportables.");
      if (total > MAX_SCENARIO_CSV_ROWS) {
        throw new Error(
          `El historial supera el máximo de ${MAX_SCENARIO_CSV_ROWS} escenarios por exportación. Usa la exportación por páginas.`,
        );
      }
    } else if (page.total !== total || page.limit !== pageSize) {
      throw new Error("El historial cambió durante la exportación. Vuelve a intentarlo.");
    }

    const needed = Math.min(page.limit, total - offset);
    if (page.items.length !== needed) {
      throw new Error("El historial devolvió una página incompleta. No se descargó un CSV parcial.");
    }
    for (const item of page.items) {
      if (item.profile_id !== expectedProfileId || item.data_type !== "SIMULADO") {
        throw new Error("La exportación contiene un escenario ajeno o no simulado.");
      }
      if (seen.has(item.id)) {
        throw new Error("El historial cambió durante la lectura; hay versiones duplicadas.");
      }
      seen.add(item.id);
      rows.push(item);
    }
    onProgress?.(rows.length, total);
  }
  assertActive(signal);
  return buildSyntheticScenarioCsv(rows);
}
