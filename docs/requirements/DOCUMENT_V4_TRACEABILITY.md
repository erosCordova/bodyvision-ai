# Trazabilidad de documentos de ingeniería v3/v4

Referencia principal: Documento Maestro Integral de Ingeniería de Software v4.0 (17/11/2026), §§2.1–2.3, 5, 8–15. Complementos: Arquitectura, Modelos Funcionales y Fases v3.0 y Documentación Técnica y Plan de Desarrollo v3.0. Las imágenes son referencias, no evidencia de implementación. El contrato IMPLEMENTATION_SPEC.md conserva sus controles más restrictivos. No se habilitan datos reales.

## Matriz de requisitos funcionales (revisión de código, no aceptación final)

| ID | Requisito | Implementación o evidencia a verificar | Pendiente de aceptación |
|---|---|---|---|
| RF-001 | Sesiones seguras | PrivateAccessPage, PrivateAuthProvider | E2E privado, revocación, MFA |
| RF-002 | Usuarios y roles | PrivateAdministrationPage | Permisos y auditoría en entorno privado |
| RF-003 | Alta de expediente | data_core.py, ProfilesPage | Alta autorizada y código único |
| RF-004 | Aislamiento | records.py, RLS y pruebas cruzadas | Reejecutar contra HEAD |
| RF-005 | Consentimiento | ConsentPanel y módulo /consents | Vigencia, revocación, aprobación legal |
| RF-006 | Mediciones | MeasurementForm, measurements.py | Precisión, unidades y métodos API |
| RF-007 | Correcciones | measurement_versions, tests de integración | Inmutabilidad e historial E2E |
| RF-008 | Carga validada | captureQuality, SyntheticCaptureArchive | MIME, tamaño, contenido y rechazo |
| RF-009 | Archivos privados | Archivo sintético privado | Storage de producción, cifrado y retención |
| RF-010 | Tarea de pose | ServerPosePanel | Worker privado ejecutado, estados y reintento |
| RF-011 | Versión y calidad | PoseReview, ServerPosePanel | Reproducibilidad, revisión humana |
| RF-012 | Activos autorizados | AnatomyAtlas | Licencia, procedencia y benchmark del activo |
| RF-013 | Capas | AnatomyAtlas | Wireframe real, landmarks cuando exista correspondencia validada; no fingir reconstrucción |
| RF-014 | Comparación temporal | /analytics, HistoryChart, MeasurementComparison | Faltantes, cambios de método y unidades |
| RF-015 | Simulación aislada | AnatomyAtlas, escenarios versionados | Verificar que no modifica observaciones |
| RF-016 | Reportes | ReportsPage, exportación longitudinal/comparativa | Fuentes, formatos, auditoría; informe integral pendiente de comprobar |
| RF-017 | Auditoría | panel de auditoría y eventos de acceso | Cobertura, integridad y exportaciones |
| RF-018 | Derechos del titular | PrivacyRequestsPage | Resolución y borrado verificable, backups y revisión legal |

## Requisitos no funcionales

RNF-01 seguridad y RNF-02 privacidad: mantener modo sintético; prueba de aislamiento y consentimiento; no declarar go-live. RNF-03 rendimiento: medir API, cola y 3D. RNF-04 disponibilidad: validar health y restauración. RNF-05 escalabilidad: comprobar worker independiente. RNF-06 mantenibilidad: lint/typecheck, tests, migraciones. RNF-07 accesibilidad: teclado, contraste y móvil. RNF-08 trazabilidad: fuentes, versiones y auditoría. RNF-09 compatibilidad: matriz de navegadores y fallback. RNF-10 interoperabilidad: OpenAPI y formatos estándar.

## Cierre

Conservar atlas elegido, animación y diseño actual; no atribuirle reconstrucción anatómica personalizada. Mapas térmicos solo si existe una métrica y correspondencia espacial justificadas. No inferir composición corporal desde imágenes. Los módulos de consentimiento y analítica tienen rutas explícitas, reutilizan la autorización y los servicios existentes. No considerar cada requisito aprobado sin prueba ejecutada y evidencia. Las fases 0–9 requieren criterios de salida del documento v4, especialmente restauración, licencia, QA, legal y operación. 
