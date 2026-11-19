/**
 * Manual engineering assessment against BODYVISION architecture v3, section 6.
 * Percentages are indicative completion estimates per phase, not test scores,
 * predictions or automated project-management telemetry.
 * Each of the ten documented phases carries the same weight (10%).
 * Reassess when a deliverable has passed its documented exit criterion.
 */
export type ProjectPhase = {
  id: number;
  name: string;
  progress: number;
  completed: string;
  pending: string;
  milestone: string;
};
export const reviewedAt = "2026-11-19";
export const phaseAssessment: ProjectPhase[] = [
  { id: 0, name: "Descubrimiento y diseño", progress: 85,
    completed: "Documentos maestros v2/v3, arquitectura y pantallas objetivo.",
    pending: "Formalizar aceptación, responsables y matriz de riesgos.",
    milestone: "Alcance y criterios firmados." },
  { id: 1, name: "Fundación técnica", progress: 90,
    completed: "Monorepo, FastAPI, React, PostgreSQL, Docker, migraciones, CI y despliegue de demostración.",
    pending: "Separación completa de entornos y manual operativo de alta.",
    milestone: "Reproducibilidad y controles de operación aprobados." },
  { id: 2, name: "Expedientes y mediciones", progress: 90,
    completed: "CRUD ficticio, métricas, validaciones, historial, correcciones y gráficos.",
    pending: "Revisión de cobertura y preparación para identidad de usuarios.",
    milestone: "Registros trazables con pruebas de aceptación finales." },
  { id: 3, name: "Seguridad e identidad", progress: 10,
    completed: "Pantalla de acceso informativa y aislamiento de organizaciones ficticias.",
    pending: "Autenticación real, RBAC, consentimiento persistente, sesiones y auditoría.",
    milestone: "Permisos cruzados y aislamiento de expedientes demostrados." },
  { id: 4, name: "Captura segura", progress: 40,
    completed: "Cámara con permiso, firma JPG/PNG/WebP, revisión de resolución, iluminación y contraste, previsualización sin subida.",
    pending: "Consentimiento verificable, subida privada, saneamiento de metadatos, almacenamiento protegido y retención.",
    milestone: "Carga segura y trazable con consentimiento comprobado." },
  { id: 5, name: "IA de pose", progress: 45,
    completed: "MediaPipe Lite/WASM verificados con SHA-256, inferencia real local, 33 landmarks y pruebas con modelo anatómico sintético.",
    pending: "Evaluación sistemática por poses/dispositivos, colas autorizadas, persistencia, auditoría y revisión humana.",
    milestone: "Resultados de pose repetibles y versionados." },
  { id: 6, name: "Visor 3D", progress: 85,
    completed: "Atlas anatómico, selección/capas, rotación, malla, estatura, captura hacia IA local y LOD geométrico reversible con pruebas.",
    pending: "Medición de rendimiento/consumo en teléfonos físicos y mejoras morfológicas calibradas.",
    milestone: "Visor 3D fluido, licenciado y validado en dispositivos objetivo." },
  { id: 7, name: "Analítica y reportes", progress: 60,
    completed: "Dashboard de datos ficticios, evolución, historial, comparación entre fechas desde API y vista previa/CSV.",
    pending: "Informes PDF trazables, exportación autorizada y estadísticas longitudinales más robustas.",
    milestone: "Informes reproducibles con fuentes y pruebas." },
  { id: 8, name: "Simulación", progress: 80,
    completed: "Peso/estatura sobre el mismo 3D, deformación regional, malla y comparación; escenarios sintéticos versionados en PostgreSQL, con RLS, historial inmutable y restauración en el visor.",
    pending: "Evaluación morfológica comparativa, autorización real de usuarios, consentimiento, pruebas con dispositivos y operaciones seguras de despliegue.",
    milestone: "Escenarios trazables sin sobrescribir observaciones." },
  { id: 9, name: "Producción", progress: 30,
    completed: "Despliegue de demostración, pipelines de compilación y pruebas con Docker.",
    pending: "Secretos, observabilidad, alertas, respaldo/restauración, revisión legal y pruebas de seguridad.",
    milestone: "Checklist de producción completado." },
];
export const overallProgress = Math.round(phaseAssessment.reduce((sum, item) => sum + item.progress, 0) / phaseAssessment.length);
export const phaseProgressMethod = "Estimación técnica manual · 10 fases con igual ponderación · no es un porcentaje certificado ni calculado automáticamente a partir de commits.";
