# Fase 9 — Comprobación de frescura de readiness local (23-11-2026)

**Alcance**: watchdog optativo y explícitamente sintético. Solo se permite
`APP_ENV=local` o `test` y `BODYVISION_ENABLE_WATCHDOG=synthetic-only`.
Nunca constituye supervisión o autorización de producción.

## Problema

El watchdog evaluaba como `ready` cualquier JSON HTTP 200 que contuviera
`status=ready`, `database=connected` y la revisión esperada del esquema,
aunque omitiera `checked_at`. Una respuesta guardada o falsificada podía
devolver un estado anterior y, con claves JSON repetidas, el analizador
tradicional aceptaba la última aparición de un campo ambiguo.

## Contrato

El monitor ahora solo interpreta una respuesta `ready` cuando el documento
JSON tiene exactamente los campos `status`, `database`, `schema_revision`
y `checked_at`, sin claves duplicadas. Requiere un timestamp ISO 8601
**con zona horaria**, antigüedad máxima de 120 segundos y tolerancia
de hasta 30 segundos al adelanto del reloj servidor. Si falta, está
corrupto, es ambiguo, anticuado o futuro fuera de ese margen, se clasifica
`degraded` sin revelar respuesta, rutas, identificadores ni datos
personales. `unreachable` se sigue reservando para fallos de transporte.

La API `/api/v1/health/ready` ya emite los cuatro campos. No cambian la
URL allowlist, la desactivación de redirecciones ni el máximo de 4096 bytes.

## Pruebas

Las pruebas en `backend/tests/unit/test_independent_service_watchdog.py`
cubren un documento vigente con sufijo `Z`, omisión/alteración de fecha,
fecha sin zona, obsoleta, futura, con campo extra, claves duplicadas y
fechas ISO extremas que desbordan al convertirlas a UTC.
La CI de GitHub debe comprobar calidad Python y los recorridos Windows,
Docker y navegador antes de integrar el PR.

## Límites

Estos márgenes son un control de coherencia, no una prueba criptográfica
de autenticidad ni de disponibilidad del host. Si relojes locales se
desincronizan, habrá degradación por diseño; no se ajustará la hora
silenciosamente. No demuestra alerta externa, SLO/SLA, PITR, RPO/RTO,
TLS, custodia de claves ni aprobación de seguridad o privacidad.
Mantener F9 en 90 % y el global estimado en 93 %.
