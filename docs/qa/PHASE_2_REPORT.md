# BODYVISION AI — Fase 2 verificada

17 de noviembre de 2026 · America/Lima.

**Estado: criterio de salida técnico F2 cumplido.** La revisión [PR #1](https://github.com/erosCordova/bodyvision-ai/pull/1) fue integrada en main después de verificar código y contenedores. No se inició F3, no se desplegó producción y no se autoriza el uso de datos de personas reales.

## Comportamiento entregado

- Directorio de dos organizaciones ficticias, cada una con su operador y catálogo de 10 métricas.
- Expedientes mínimos: búsqueda/paginación, creación, edición de referencia, restricción y archivo de solo lectura.
- Mediciones OBSERVADO con método manual/device, unidad, fecha, instrumento cuando corresponde y responsable. Se rechazan valores fuera de catálogo, fechas futuras, unidades/métodos incompatibles y valores visual_estimate. Para menores ficticios solo se permiten registros manuales.
- Corrección con motivo obligatorio: crea un sucesor y conserva valor/fecha/método originales. Privilegios y triggers impiden sobrescritura/borrado; historial completo desde cualquier versión. Bloqueo de fila para coordinar registro con cambios de estado del expediente.
- Idempotency-Key estable por envío y detección de reutilización con otro cuerpo; duplicados y atípicos exigen confirmación explícita.
- IMC, cintura/cadera y cintura/estatura rotulados DERIVADO, con fórmula, fuentes, fecha de corte y motivo cuando falta información. Sin interpretación clínica; cintura/cadera requiere una ventana de 7 días.
- Resumen de organización y actividad desde SQL; historial vigente paginado; evolución por métrica/periodo con huecos sin interpolación. Recharts se carga bajo demanda; nunca se mezclan simulaciones con observaciones.
- Formularios con validación, carga/error/éxito/vacío, anti doble envío, referencias de error, reintento, aviso de cambios al cerrar/reload y navegación de teclado. Organización seleccionada guardada solo como metadata sintética de la pestaña.
- make seed crea 5 expedientes por organización con seis cortes mensuales, huecos, un atípico y una corrección; es explícito, idempotente y no sobrescribe registros.

## Verificación ejecutada

Ejecución remota: [GitHub Actions 44116998812](https://github.com/erosCordova/bodyvision-ai/actions/runs/44116998812). Commit de código verificado: `7a563f7303d04e87745909762aaa71256d3a4c1c`. Merge: `88a529e5c0925165f4e0a3f6809c9a29c2a4f2bd`.

| Control | Resultado real |
|---|---|
| Backend con PostgreSQL 15 | 40 pruebas aprobadas, incluida RLS directa y rechazo de sobrescritura/borrado |
| Frontend unitario | 11 pruebas aprobadas |
| Playwright | 5 recorridos aprobados |
| axe | Sin infracciones en las vistas y reglas WCAG configuradas de los recorridos |
| Ruff / formato / ESLint / TypeScript | Aprobados |
| Instalación, lockfiles y build | Aprobados; gráfico en un chunk separado |
| Alembic | Upgrade, downgrade y reaplicación comprobados |
| Fixtures | Primera carga: 10 expedientes; segunda: 0; existentes conservados |
| Arranque nativo local | Uvicorn y Vite arrancados; seis rutas HTTP 200; cinco expedientes ficticios visibles por organización |
| Docker limpio | Imágenes construidas; PostgreSQL, API y frontend Healthy; seed y pruebas en contenedores aprobados |
| Avisos conocidos | npm audit y pip-audit sin avisos en esa ejecución |

Los cinco recorridos del navegador incluyen el flujo crear expediente → peso → corrección → ambas versiones → estatura → derivadas → cambio de organización y denegación del expediente ajeno; móvil/gráfico/atípico/axe; y las tres comprobaciones de salud, teclado y recuperación de F1. La primera ejecución remota detectó una falta de enlace de salto al contenido y un selector de etiqueta ambiguo: se corrigieron y todos los escenarios se repitieron con éxito.

Evidencia: [resumen remoto](evidence/phase2/github-actions.json), salidas locales en docs/qa/evidence/phase2 y logs completos del run. No se afirma validación de navegadores distintos del Chromium del runner ni revisión manual completa de WCAG.

## Archivos y decisiones

Migración 0002_data_core; schemas, contexto local, repositorios y servicios; rutas y seed; UI de resumen/expedientes/mediciones/evolución; DataTypeBadge, modal y estados; pruebas API/RLS/UI/E2E; Compose seed, CI, README y documentación. El [manifiesto](FILES_CREATED.txt) enumera los archivos vigentes. El [ADR 0005](../adr/0005-synthetic-data-core.md) documenta el contexto sintético y su sustitución obligatoria en F3.

## Límites y riesgos que continúan

El selector X-Workspace-ID no autentica a nadie: sirve exclusivamente para estas organizaciones ficticias. RLS, filtros y ProfileAccess de F2 no sustituyen una sesión. Staging/production continúan rechazados. Identidad/MFA/RBAC, contexto de organización derivado de sesión, consentimientos versionados, auditoría append-only y gate R11 granular quedan en F3 antes de datos reales.

No existen todavía captura, pose, visor 3D, simulaciones, reportes ni ARCO. Tampoco se ha afirmado cumplimiento legal o preparación productiva. El downgrade es destructivo y se comprobó solo sobre bases descartables. Se conserva una advertencia no bloqueante de Starlette sobre la futura transición de su adaptador de pruebas httpx.

La siguiente fase es identidad y privacidad; esta entrega se detiene al cerrar F2.
