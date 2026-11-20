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
export const reviewedAt = "2026-11-20";
export const phaseAssessment: ProjectPhase[] = [
  { id: 0, name: "Descubrimiento y diseño", progress: 85,
    completed: "Documentos maestros v2/v3, arquitectura y pantallas objetivo.",
    pending: "Formalizar aceptación, responsables y matriz de riesgos.",
    milestone: "Alcance y criterios firmados." },
  { id: 1, name: "Fundación técnica", progress: 95,
    completed: "Monorepo, FastAPI, React, PostgreSQL, Docker, migraciones y CI. Comprobador de arranque y pruebas Docker en base temporal/red separadas, con verificación del contenido local antes y después.",
    pending: "Recepción operativa independiente del alta. La separación de staging/producción y respaldo sigue en F9.",
    milestone: "Reproducibilidad y controles de operación aprobados." },
  { id: 2, name: "Expedientes y mediciones", progress: 90,
    completed: "CRUD ficticio, métricas, validaciones, historial, correcciones y gráficos.",
    pending: "Revisión de cobertura y preparación para identidad de usuarios.",
    milestone: "Registros trazables con pruebas de aceptación finales." },
  { id: 3, name: "Seguridad e identidad", progress: 75,
    completed: "Usuarios y roles ficticios, permisos por expediente, sesiones revocables, consentimiento, auditoría encadenada y MFA TOTP/recuperación bajo activación local/test.",
    pending: "Alta verificada de primer administrador, recuperación externa de identidad, rotación de claves, anclaje de auditoría y evaluación de seguridad/privacidad antes de datos reales.",
    milestone: "Permisos cruzados y aislamiento de expedientes demostrados." },
  { id: 4, name: "Captura segura", progress: 70,
    completed: "Cámara y calidad local, aislamiento por sesión, PNG ficticios cifrados con permisos y doble consentimiento, purga periódica, recuperación y rotación de claves con auditoría. La captura ahora comparte con IA la validación previa de cabeceras y límites de PNG/JPEG/WebP, confirma dimensiones decodificadas y libera superficies temporales con pruebas aprobadas.",
    pending: "Consentimiento legal para datos reales, inventario completo de claves anteriores, purga externa con el backend apagado, gestión de backups/WAL y eliminación verificable, revisión clínica y seguridad antes de producción.",
    milestone: "Carga segura y trazable con consentimiento comprobado." },
  { id: 5, name: "IA de pose", progress: 65,
    completed: "MediaPipe Lite/WASM SHA-256 con 33 landmarks locales, aislamiento de resultados obsoletos, validación previa de PNG/JPEG/WebP y gates de poses degeneradas. Matriz real de nueve condiciones sintéticas, benchmark local y captura opaca del mismo atlas 3D que ya supera 4/4 controles de imagen y mantiene detección real, todo con CI aprobada.",
    pending: "Exactitud sobre corpus independiente autorizado, pruebas físicas por dispositivo/postura/iluminación, medición de recursos, revisión de privacidad y clínica, persistencia y auditoría autorizadas. Las pruebas sintéticas no certifican precisión diagnóstica.",
    milestone: "Resultados de pose repetibles y versionados." },
  { id: 6, name: "Visor 3D", progress: 85,
    completed: "Atlas anatómico, selección/capas, rotación, malla, estatura, captura hacia IA local y LOD geométrico reversible con pruebas.",
    pending: "Medición de rendimiento/consumo en teléfonos físicos y mejoras morfológicas calibradas.",
    milestone: "Visor 3D fluido, licenciado y validado en dispositivos objetivo." },
  { id: 7, name: "Analítica y reportes", progress: 75,
    completed: "Dashboard ficticio, evolución, historial, comparación entre fechas desde API, vista previa/CSV, informe imprimible A4 con trazabilidad y resumen longitudinal con mediana, extremos, cambio observado, brechas y advertencias, con pruebas aprobadas.",
    pending: "PDF de servidor con firma/autenticidad y auditoría de exportaciones, autorización para datos reales, validación longitudinal con fuentes completas y evaluación clínica de la interpretación. La exportación local solo admite expedientes ficticios.",
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
