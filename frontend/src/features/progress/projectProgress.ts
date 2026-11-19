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
export const reviewedAt = "2026-11-18";
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
  { id: 3, name: "Seguridad e identidad", progress: 40,
    completed: "Acceso privado de pruebas, sesiones, roles, permisos por expediente, auditoría parcial y consentimientos versionados con revocación.",
    pending: "Alta administrativa inicial, recuperación de cuentas, MFA, auditoría de denegaciones y revisión integral de privacidad antes del uso real.",
    milestone: "Permisos cruzados y aislamiento de expedientes demostrados." },
  { id: 4, name: "Captura segura", progress: 15,
    completed: "Guía visual y previsualización local de imágenes.",
    pending: "Subida privada, validación del archivo, eliminación de metadatos, checksum, retención y calidad.",
    milestone: "Carga segura y trazable con consentimiento comprobado." },
  { id: 5, name: "IA de pose", progress: 5,
    completed: "Pantalla explicativa del proceso de landmarks y control de calidad.",
    pending: "MediaPipe en ejecución, cola asíncrona, versión del modelo y revisión de resultados.",
    milestone: "Resultados de pose repetibles y versionados." },
  { id: 6, name: "Visor 3D", progress: 70,
    completed: "Modelos 3D, atlas por capas, selección, rotación, transparencia, wireframe y pruebas visuales.",
    pending: "LOD móvil, prueba de rendimiento completa y mejor morfología de tejidos.",
    milestone: "Visor 3D fluido, licenciado y validado en dispositivos objetivo." },
  { id: 7, name: "Analítica y reportes", progress: 50,
    completed: "Dashboard de datos ficticios, evolución, historial y vista previa/CSV.",
    pending: "Informes PDF trazables, series completas, exportación autorizada y estadísticas más robustas.",
    milestone: "Informes reproducibles con fuentes y pruebas." },
  { id: 8, name: "Simulación", progress: 45,
    completed: "Escenario hipotético sobre el 3D, malla, comparación y etiqueta no clínica.",
    pending: "Motor de escenarios formal, versionado y comparaciones persistentes y autorizadas.",
    milestone: "Escenarios trazables sin sobrescribir observaciones." },
  { id: 9, name: "Producción", progress: 30,
    completed: "Despliegue de demostración, pipelines de compilación y pruebas con Docker.",
    pending: "Secretos, observabilidad, alertas, respaldo/restauración, revisión legal y pruebas de seguridad.",
    milestone: "Checklist de producción completado." },
];
export const overallProgress = Math.round(phaseAssessment.reduce((sum, item) => sum + item.progress, 0) / phaseAssessment.length);
export const phaseProgressMethod = "Estimación técnica manual · 10 fases con igual ponderación · no es un porcentaje certificado ni calculado automáticamente a partir de commits.";
