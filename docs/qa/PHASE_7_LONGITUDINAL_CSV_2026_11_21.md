# BODYVISION AI — Fase 7: aceptación del historial longitudinal CSV (21-11-2026)

## Entregable y alcance

El espacio privado de pruebas ofrece **Expedientes → Evolución → Descargar
historial observado (CSV)** para la métrica y periodo seleccionados. A diferencia
de la tabla paginada de 20 observaciones, el backend obtiene directamente las
fuentes vigentes desde PostgreSQL en una consulta con instantánea consistente.
El archivo incluye UUID de medición, tiempo UTC, métrica, valor Decimal,
unidad, método e indicador de atípico confirmado. No incluye escenarios
simulados ni versiones sustituidas. Solo funciona en organizaciones
**ficticias** con acceso autorizado a ese expediente, en entorno local/test.

Se exportan de 1 a 500 filas. Si el periodo supera 500, el backend
**rechaza** la operación con un error explícito; jamás entrega una página
parcial con apariencia de historial completo. Los valores y etiquetas del CSV
se obtienen del servidor, no de datos proporcionados por la petición.
Las cadenas se protegen frente a interpretaciones como fórmulas en hojas
de cálculo.

## Controles de integridad y seguridad

La generación queda registrada en la cadena transaccional de auditoría
del expediente mediante el evento actual \`report.export\`; un fallo de
auditoría impide entregar bytes. La respuesta entrega SHA-256 de los bytes
del CSV y el navegador verifica el digest y la estructura antes de
crear la descarga temporal. Cambiar de expediente, métrica o periodo
descarta las respuestas tardías. Las respuestas no se almacenan
en caché y el archivo no se guarda en el servidor por esta función.

Los eventos actuales **no distinguen CSV de PDF** y no contienen el hash
del archivo. La huella recibida en el mismo canal permite revisar
integridad de transporte, **no es firma digital ni prueba independiente
de origen**. Tampoco acredita que la descarga local terminara o que
la información tenga validez clínica.

## Aceptación de CI

- Implementación de backend y unidad: \`backend/app/api/routes/comparison_reports.py\`,
  \`backend/app/services/longitudinal_csv.py\`,
  \`backend/tests/unit/test_longitudinal_csv.py\`.
- Integración PostgreSQL: \`backend/tests/integration/test_comparison_export.py\`,
  con aislamiento de organizaciones, permisos, fuentes, versión reemplazada,
  Decimal exacto, autorización y rollback si la auditoría falla.
- Frontend y navegador privado:
  \`frontend/src/features/analytics/serverLongitudinalExport.ts\`,
  \`LongitudinalSummary.tsx\`,
  \`frontend/tests/serverLongitudinalExport.test.ts\`,
  \`frontend/tests/private-e2e/comparison-report.spec.ts\`.

**CI aprobada:** [BODYVISION CI 44967597848](https://github.com/erosCordova/bodyvision-ai/actions/runs/44967597848)
para el commit \`3b94390acfd630937e150164973822d0b52e9a9c\`:
**291 pruebas backend, 270 frontend, 43 públicas, 8 privadas, 612 en total**,
además de Windows, Docker, migraciones y recuperación.
[Aceptación de retención 44967597819](https://github.com/erosCordova/bodyvision-ai/actions/runs/44967597819)
también aprobada.

## Reevaluación manual

Se considera aprobado el criterio técnico de exportación longitudinal
trazable y completa **dentro de la cota explícita de 500 registros**.
La fase 7 pasa del **80 al 90 %**. La media exacta del proyecto de
diez fases pasa del **88,5 al 89,5 %**, presentado en el tablero como
**90 % redondeado**. No hay certificación de producto ni cierre clínico.

Pendientes: autenticidad externa y firma digital, auditoría diferenciada
de formatos y recepción, historial de más de 500 registros sin truncar,
autorización de uso con datos reales, interpretación longitudinal validada
y revisión independiente de privacidad/seguridad.
