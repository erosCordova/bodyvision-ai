/**
 * Phase 0–2 gate evidence. A verified technical step is NOT a signed product
 * acceptance. Avoid inventing approvals or converting CI into clinical sign-off.
 * The ten-phase progress display follows architecture v3 (0–9), while the
 * repository's IMPLEMENTATION_SPEC uses F1–F10 for a separate execution plan.
 */
export type GateEvidence = { label: string; url: string };
export type PhaseGateCheck = {
  id: string;
  requirement: string;
  state: "verified" | "pending";
  evidence?: GateEvidence;
  pendingReason?: string;
};
export type PhaseClosureAudit = {
  phaseId: 0 | 1 | 2;
  title: string;
  technical: "verified" | "pending";
  formalAcceptance: "pending" | "product-approved";
  operationalReception?: "assisted";
  mappedExecutionPhase: string;
  owner: string;
  checks: readonly PhaseGateCheck[];
};

const repo = "https://github.com/erosCordova/bodyvision-ai";
const doc = (path: string): string =>
  repo + "/blob/feature/phase3-auth-security/" + path;

export const phaseClosureAudit: readonly PhaseClosureAudit[] = [
  {
    phaseId: 0, title: "Descubrimiento y diseño",
    technical: "verified", formalAcceptance: "product-approved",
    mappedExecutionPhase: "Preparatoria del tablero 0–9; sin equivalente F0 explícito en la especificación F1–F10.",
    owner: "Responsable de producto: usuario del proyecto (aprobación expresa del 23-11-2026)",
    checks: [
      {
        id: "F0-SCOPE", requirement: "Alcance, limitaciones médicas y reglas de privacidad documentados.",
        state: "verified",
        evidence: { label: "Contrato de requisitos", url: doc("docs/requirements/IMPLEMENTATION_SPEC.md") },
      },
      {
        id: "F0-ARCH", requirement: "Arquitectura inicial y decisión tecnológica documentadas.",
        state: "verified",
        evidence: { label: "Arquitectura y ADR", url: doc("docs/architecture/ARQUITECTURA.md") },
      },
      {
        id: "F0-RISK", requirement: "Planificación y tratamiento de riesgos aceptados como plan de trabajo; revisiones especializadas pendientes en sus fases.",
        state: "verified",
        evidence: { label: "Propuesta de cierre y matriz de riesgos", url: doc("docs/qa/PHASE_0_SCOPE_REVIEW.md") },
      },
      {
        id: "F0-APPROVAL", requirement: "Aceptación explícita del alcance y criterios de salida por producto.",
        state: "verified",
        evidence: { label: "Registro de aprobación expresa de producto", url: doc("docs/qa/PHASE_0_PRODUCT_ACCEPTANCE_2026_11_23.md") },
      },
    ],
  },
  {
    phaseId: 1, title: "Fundación técnica",
    technical: "verified", formalAcceptance: "pending",
    operationalReception: "assisted",
    mappedExecutionPhase: "F1 de IMPLEMENTATION_SPEC: monorepo, Docker, PostgreSQL/Alembic, API, React y CI.",
    owner: "Usuario local: instalación y reinicio; revisión asistida desde Chrome",
    checks: [
      {
        id: "F1-CI", requirement: "Instalación, build, migraciones y pruebas en checkout limpio.",
        state: "verified",
        evidence: { label: "CI fase 1", url: repo + "/actions/runs/44110966237" },
      },
      {
        id: "F1-DOCKER", requirement: "Arranque Docker, health real y smoke con PostgreSQL.",
        state: "verified",
        evidence: { label: "Reporte técnico F1", url: doc("docs/qa/PHASE_1_REPORT.md") },
      },
      {
        id: "F1-TEST-ISOLATION", requirement: "Pruebas Docker en base y red separadas, conservando los datos locales.",
        state: "verified",
        evidence: { label: "Aislamiento y conservación de datos", url: doc("docs/operations/LOCAL_TEST_DATABASE_ISOLATION.md") },
      },
      {
        id: "F1-DOCKER-RESTART", requirement: "Interfaz compilada navegable y correcciones conservadas tras recrear contenedores.",
        state: "verified",
        evidence: { label: "Navegador Docker y reinicio", url: doc("docs/qa/PHASE_1_DOCKER_BROWSER_RESTART.md") },
      },
      {
        id: "F1-HANDOFF", requirement: "Recepción local en Windows con instalación del usuario y verificación asistida tras reiniciar.",
        state: "verified",
        evidence: { label: "Recepción asistida de Windows", url: doc("docs/qa/PHASE_1_WINDOWS_ASSISTED_RECEPTION.md") },
      },
    ],
  },
  {
    phaseId: 2, title: "Expedientes y mediciones",
    technical: "verified", formalAcceptance: "product-approved",
    mappedExecutionPhase: "F2 de IMPLEMENTATION_SPEC: expediente, catálogo, mediciones, derivadas y gráficos.",
    owner: "Usuario del proyecto: conformidad expresa de producto (23-11-2026); revisores independientes pendientes",
    checks: [
      {
        id: "F2-CRUD", requirement: "Alta, consulta y corrección versionada sin sobrescribir observaciones.",
        state: "verified",
        evidence: { label: "CI núcleo de datos", url: repo + "/actions/runs/44116998812" },
      },
      {
        id: "F2-ISOLATION", requirement: "Aislamiento de organizaciones y acceso por expediente en PostgreSQL.",
        state: "verified",
        evidence: { label: "Reporte técnico F2", url: doc("docs/qa/PHASE_2_REPORT.md") },
      },
      {
        id: "F2-VISUAL", requirement: "Derivadas con fuentes, gráficos con huecos y diferenciación de datos.",
        state: "verified",
        evidence: { label: "Prueba E2E núcleo de datos", url: doc("frontend/tests/e2e/data-core.spec.ts") },
      },
      {
        id: "F2-TIMESTAMP", requirement: "Corregir un valor no cambia silenciosamente el instante observado.",
        state: "verified",
        evidence: { label: "Precisión temporal de las correcciones", url: doc("docs/qa/PHASE_2_CORRECTION_TIMESTAMP.md") },
      },
      {
        id: "F2-ACCEPTANCE", requirement: "Aceptación funcional final del flujo ficticio por el responsable del producto.",
        state: "verified",
        evidence: { label: "Aceptación expresa del flujo ficticio por producto", url: doc("docs/qa/PHASE_2_PRODUCT_ACCEPTANCE_2026_11_23.md") },
      },
    ],
  },
];

/** The dashboard must not claim formal acceptance just because CI passed. */
export const closedWithFormalAcceptance = phaseClosureAudit.filter(
  phase => phase.formalAcceptance !== "pending",
).length;
