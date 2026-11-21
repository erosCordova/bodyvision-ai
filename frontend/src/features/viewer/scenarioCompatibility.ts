/**
 * Synthetic scenario replay is meaningful only with the exact atlas and
 * regional deformation algorithm used when its append-only record was saved.
 * The historical list remains readable, but incompatible versions must not
 * be rendered using a different avatar or engine while pretending equality.
 */
import type { SimulationScenario } from "../../services/api/records";
import { anatomyRevision } from "./atlasSource";
import { SOFT_TISSUE_PROFILE_VERSION } from "./softTissueProfile";

type Provenance = Pick<SimulationScenario, "data_type" | "model_revision" | "algorithm_revision">;

export function scenarioCompatibilityReason(row: Provenance): string | null {
  if (row.data_type !== "SIMULADO") {
    return "Solo se pueden reproducir registros rotulados como SIMULADO.";
  }
  if (row.model_revision !== anatomyRevision) {
    return "El modelo anatómico usado para guardar esta versión es diferente. Solo consulta histórica.";
  }
  if (row.algorithm_revision !== SOFT_TISSUE_PROFILE_VERSION) {
    return "El algoritmo visual usado para guardar esta versión es diferente. Solo consulta histórica.";
  }
  return null;
}
