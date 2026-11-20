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
  formalAcceptance: "pending";
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
    technical: "pending", formalAcceptance: "pending",
    mappedExecutionPhase: "Preparatoria del tablero 0–9; sin equivalente F0 explícito en la especificación F1–F10.",
    owner: "Responsable de producto por confirmar",
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
        id: "F0-RISK", requirement: "Matriz de riesgos revisada, con responsables y medidas aprobadas.",
        state: "pending", pendingReason: "Existe una matriz preliminar; falta asignar responsables y aceptarla.",
        evidence: { label: "Registro preliminar de riesgos", url: doc("docs/qa/PHASE_0_2_ACCEPTANCE_AUDIT.md") },
      },
      {
        id: "F0-APPROVAL", requirement: "Aceptación explícita del alcance y criterios de salida por producto.",
        state: "pending", pendingReason: "Nadie ha autorizado ni firmado una aceptación formal.",
      },
    ],
  },
  {
    phaseId: 1, title: "Fundación técnica",
    technical: "verified", formalAcceptance: "pending",
    mappedExecutionPhase: "F1 de IMPLEMENTATION_SPEC: monorepo, Docker, PostgreSQL/Alembic, API, React y CI.",
    owner: "Responsables de ingeniería, operaciones y QA por confirmar",
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
        id: "F1-HANDOFF", requirement: "Alta operativa reproducida por una segunda persona en el entorno objetivo.",
        state: "pending", pendingReason: "CI confirma la receta en runner; no hay constancia de aceptación humana de instalación.",
        evidence: { label: "Guía de alta y entornos", url: doc("docs/operations/PHASE_1_HANDOFF_CHECKLIST.md") },
      },
    ],
  },
  {
    phaseId: 2, title: "Expedientes y mediciones",
    technical: "verified", formalAcceptance: "pending",
    mappedExecutionPhase: "F2 de IMPLEMENTATION_SPEC: expediente, catálogo, mediciones, derivadas y gráficos.",
    owner: "Responsables de producto, dominio y QA por confirmar",
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
        id: "F2-ACCEPTANCE", requirement: "Aceptación funcional final del flujo ficticio por el responsable del producto.",
        state: "pending", pendingReason: "El cierre técnico consta; falta la revisión y conformidad del responsable.",
      },
    ],
  },
];

/** The dashboard must not claim formal acceptance just because CI passed. */
export const closedWithFormalAcceptance = phaseClosureAudit.filter(
  phase => phase.formalAcceptance !== "pending",
).length;
