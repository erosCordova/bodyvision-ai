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
  { id: 1, name: "Fundación técnica", progress: 100,
    completed: "Monorepo, FastAPI, React, PostgreSQL, Docker, migraciones y CI; pruebas aisladas y conservación de datos. Recepción asistida en Windows: instalación/reinicio del usuario, revisión desde Chrome y versiones 72/72/71 kg conservadas; API y esquema conectados tras el reinicio.",
    pending: "Sin pendientes del cierre técnico local ficticio. Firmas de producto, otras plataformas, staging/producción y respaldo conservan sus propios criterios; esta recepción no los certifica.",
    milestone: "Reproducibilidad y controles de operación aprobados." },
  { id: 2, name: "Expedientes y mediciones", progress: 95,
    completed: "CRUD ficticio, métricas, validaciones, historial, correcciones y gráficos; integración privada con identidad. Las correcciones de valor conservan segundos/microsegundos originales cuando no se edita la fecha, con prueba de formulario y persistencia real API/UI.",
    pending: "Recepción funcional independiente del flujo ficticio y conformidad final de producto/QA.",
    milestone: "Registros trazables con pruebas de aceptación finales." },
  { id: 3, name: "Seguridad e identidad", progress: 85,
    completed: "Identidad y roles ficticios, permisos por expediente, sesiones revocables, consentimientos, auditoría encadenada y MFA TOTP con recuperación por código único en local/test. Alta inicial controlada del primer administrador ficticio y recifrado MFA fuera de línea: requieren rol migrador, base local y auditoría transaccional. Rotación probada en PostgreSQL, Windows, Docker y navegador con ejecución integral 44827504437. No son procesos para personas reales.",
    pending: "Verificación de identidad del primer administrador real, recuperación asistida sin códigos, respaldo y custodia externa de claves, aprobación humana de rotación, anclaje externo de auditoría y revisión independiente de seguridad/privacidad antes de datos reales.",
    milestone: "Permisos cruzados y aislamiento de expedientes demostrados." },
  { id: 4, name: "Captura segura", progress: 80,
    completed: "Cámara y calidad local, aislamiento por sesión, validación de imágenes y PNG ficticios cifrados en PostgreSQL con doble consentimiento, autorización, historial paginado, caducidad, purga y rotación auditadas. Proceso de retención independiente y optativo con rol limitado: Docker probó la purga de una captura ficticia vencida con la API apagada, conservó otra vigente y recuperó la API. Windows, PostgreSQL, Docker y navegador aprobados en CI 44833432116.",
    pending: "Consentimiento legal para fotos reales, inventario y custodia de claves, limpieza cuando Docker o PostgreSQL están apagados, política/verificación de eliminación de backups/WAL/descargas, revisión clínica y seguridad antes de producción.",
    milestone: "Carga ficticia autorizada, cifrada, paginada y retención independiente verificada." },
  { id: 5, name: "IA de pose", progress: 85,
    completed: "MediaPipe Lite/WASM SHA-256 con 33 landmarks locales, validación de imágenes y gates de poses degeneradas; matriz sintética de nueve condiciones y atlas 3D compartido. Historial privado de resúmenes mínimos versionados por expediente, sin fotografía, con doble aceptación, permisos, auditoría, paginación e idempotencia irreversible tras borrado. Purga física por caducidad de consentimientos o ausencia de sus registros, por lotes de hasta 100, mediante el servicio privado o un trabajador independiente optativo. Validación específica PostgreSQL: 39 pruebas, migración reversible y control de permisos aprobados (CI 44858285862); CI integral 44860466774 validó todas las pruebas con retención y navegador.",
    pending: "Exactitud sobre corpus independiente autorizado, pruebas físicas por dispositivo/postura/iluminación, medición de recursos, aprobación para datos reales, retención de auditoría, claves y respaldos, revisión independiente de privacidad y clínica. el servidor conserva resúmenes declarados por el navegador y las pruebas sintéticas no certifican precisión diagnóstica.",
    milestone: "Resultados de pose repetibles y versionados." },
  { id: 6, name: "Visor 3D", progress: 85,
    completed: "Atlas anatómico, selección/capas, rotación, malla, estatura, captura hacia IA local y LOD geométrico reversible con pruebas.",
    pending: "Medición de rendimiento/consumo en teléfonos físicos y mejoras morfológicas calibradas.",
    milestone: "Visor 3D fluido, licenciado y validado en dispositivos objetivo." },
  { id: 7, name: "Analítica y reportes", progress: 80,
    completed: "Dashboard ficticio, evolución, historial, comparación entre fechas desde API, vista previa/CSV, PDF privado generado en servidor desde fuentes vigentes, descarga con SHA-256 y auditoría transaccional; informe imprimible A4 y resumen longitudinal con mediana, extremos, cambio observado, brechas y advertencias, con pruebas aprobadas.",
    pending: "Firma digital y autenticidad verificable externamente del PDF, autorización para datos reales, validación longitudinal con fuentes completas y evaluación clínica de la interpretación. Las exportaciones locales y de servidor solo admiten expedientes ficticios.",
    milestone: "Informes reproducibles con fuentes y pruebas." },
  { id: 8, name: "Simulación", progress: 85,
    completed: "Peso/estatura sobre el mismo atlas 3D, deformación regional, malla, comparación histórica, PNG y versiones sintéticas inmutables en PostgreSQL. Paginación/CSV restringido, protección de versiones del motor, matriz matemática de 960 combinaciones y aviso de saturación del shader; batería Windows, Docker, backend y navegador aprobada en GitHub Actions 44823204295.",
    pending: "Evaluación morfológica independiente con referencias autorizadas, pruebas de GPU/teléfonos físicos, consentimientos y autorización real, evaluación clínica y operaciones seguras antes de desplegar. La matriz sintética no estima anatomía personal.",
    milestone: "Escenarios trazables sin sobrescribir observaciones." },
  { id: 9, name: "Producción", progress: 55,
    completed: "Despliegue de demostración, pipelines de compilación y pruebas con Docker. Restauración lógica de PostgreSQL 15 con datos sintéticos comprobada en base aislada: esquema y contenido tras el respaldo comparados en CI (run 44806178898, docker-smoke aprobado). Es una prueba técnica, no un respaldo operativo real. Diagnóstico administrativo por organización/proceso con muestra acotada, P95 y avisos; sondeo de esquema/conexión y estado de retención con recuperación; procedimiento de atención y pruebas completas aprobadas en CI 44841638430. Vigilante independiente y optativo, restringido a local/test sintético, sin credenciales ni puertos externos: detecta API caída y recuperación por readiness, con cambios de estado sanitizados; prueba Docker real y CI integral 44861754261 aprobadas. Historial técnico local SQLite, separado de PostgreSQL: 256 cambios de estado como máximo durante siete días, lectura tras reinicio y eliminación de duplicados; ensayo Docker real y CI integral 44863258689 aprobadas.",
    pending: "Secretos y rotación, histórico externo centralizado y entre procesos, notificaciones fuera del host y supervisión cuando Docker o el equipo completo no responden, respaldos productivos/PITR, cifrado y custodia de copias, política de retención, ensayos de RPO/RTO, revisión legal, privacidad y pruebas de seguridad.",
    milestone: "Checklist de producción completado." },
];
export const overallProgress = Math.round(phaseAssessment.reduce((sum, item) => sum + item.progress, 0) / phaseAssessment.length);
export const phaseProgressMethod = "Estimación técnica manual · 10 fases con igual ponderación · no es un porcentaje certificado ni calculado automáticamente a partir de commits.";
