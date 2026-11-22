# Fase 4 — Purga de capturas ficticias frente a una copia restaurada (revisión 22-11-2026)

Rama de integración, **no producción**. Solo capturas ficticias y bases locales.

## Pregunta que responde este subcomponente

El worker independiente (`app.workers.independent_capture_retention`) borra el
ciphertext vencido sin depender de la API ni de las claves de sesión/MFA. Pero
ninguna base de datos puede demostrar por sí sola que un respaldo anterior, un
segmento WAL, una instantánea de almacenamiento o una réplica no van a
resucitar la captura más tarde. Este subcomponente responde una pregunta más
estrecha y honesta:

> Dado un manifiesto de capturas purgadas de la base activa, ¿alguna de ellas
> sigue presente en una copia restaurada consultada en modo lectura?

Un resultado limpio **nunca** se convierte en «borrado global verificado».

## Archivos nuevos

- `backend/app/workers/capture_retention_recovery.py`: verificación de
  reaparición. Carga y valida el manifiesto (id UUID + `sha256_digest` de 64
  hex, deduplicado por id), exige entorno `APP_ENV=local|test`, activación
  `BODYVISION_ENABLE_CAPTURE_RETENTION=synthetic-only` y URL
  `postgresql+psycopg://`; abre la copia con `default_transaction_read_only=on`,
  `statement_timeout=5000`, `connect_timeout=3`, `NullPool` y
  `hide_parameters=True`; compara por `id` **o** `sha256_digest`; emite un
  reporte con `global_verified_deletion: false` y la lista de límites.
- `backend/tests/unit/test_capture_retention_recovery_report.py`: manifiesto en
  objeto y en lista, deduplicación, entradas malformadas (digest, id, tipo),
  JSON ilegible, entorno denegado (`APP_ENV`, activación, URL), reporte con
  discrepancia y reporte sin reaparición, ambos sin veredicto global.
- `backend/tests/integration/test_capture_retention_recovery.py`: ensayo real
  contra PostgreSQL (ver abajo).
- Este documento.

No se modificaron el worker offline existente, la función SQL de purga, la API,
el frontend, el atlas, el simulador, los reportes, el almacenamiento ni los
despliegues.

## Ensayo ejecutado (evidencia real)

Base: PostgreSQL **16.2** en `127.0.0.1:5433` (clúster TCP UTF-8 desechable),
roles `bodyvision_app` / `bodyvision_auth_app`, `REVOKE CREATE ON SCHEMA public
FROM PUBLIC`, `alembic upgrade head` (`0026_refresh_session_families`).

1. **Purga sin API.** Se crean dos capturas ficticias por la API real (consentimiento
   `capture` + `storage`, PNG determinista, confirmación sintética), se vencen por
   SQL y se ejecuta
   `python -m app.workers.independent_capture_retention --once` en un
   **subproceso** cuyo entorno solo contiene `APP_ENV`, `IDENTITY_ENABLED`,
   `BODYVISION_ENABLE_CAPTURE_RETENTION`, `DATABASE_URL`, `PYTHONPATH` y `PATH`:
   sin `JWT_SECRET`, sin claves MFA y sin `CAPTURE_ENCRYPTION_KEY`. El worker
   informa `deleted_count=2`, las dos filas desaparecen y
   `synthetic_capture_maintenance_events` registra `deleted_count=2`. Una segunda
   pasada informa `0`.
2. **Reaparición desde un respaldo.** Se guarda el `sha256_digest` y el ciphertext
   previos a la purga, se purga la captura y se crea una base **aislada**
   (`CREATE DATABASE`, `alembic upgrade head` en el mismo clúster) donde se
   inserta la fila prepurga, simulando un respaldo antiguo. El verificador sobre
   esa copia devuelve `status=discrepancy`, la captura reaparecida con su digest
   y `global_verified_deletion=false`. Tras borrar la fila de la copia, la misma
   verificación devuelve `no-reappearance-observed` y **sigue** con
   `global_verified_deletion=false`. La base activa, ya limpia, tampoco autoriza
   el veredicto global.
3. **Rol con RLS.** El verificador **rechaza** (`RecoveryVerificationDenied`)
   una conexión con `bodyvision_app`/`bodyvision_auth_app`: sin contexto de
   organización, RLS ocultaría filas y produciría un falso «no reaparece».
4. **Aislamiento entre organizaciones.** Una captura vencida de la organización
   A se purga mientras una captura **vigente** de la organización B permanece
   intacta (ciphertext presente). La doble purga es idempotente (`0` la segunda
   vez) y la fila válida sigue ahí.
5. **Fallo controlado.** Con una copia inalcanzable
   (`127.0.0.1:1`, contraseña marcador), `find_reappeared` lanza
   `RecoveryVerificationError` cuyo texto no contiene ni la contraseña ni la
   cadena `postgresql+psycopg`.

Resultados locales (`pytest -q -p no:randomly`, 22-11-2026):

- Suite completa del backend sobre el clúster TCP: **418 passed, 1 failed**,
  3 warnings, 153,12 s. El único fallo es
  `tests/integration/test_postgres.py::test_actual_database_has_revision`, que
  exige PostgreSQL 15 y el sandbox usa 16.2; no se relaciona con este cambio.
- Los 21 tests nuevos (**16 unitarios + 5 de integración**) pasan en aislamiento
  y dentro de la suite.
- `ruff check` y `ruff format --check` sin hallazgos en `app`, `tests` y
  `alembic` (134 archivos).

Esta evidencia es local; la validación en CI se reporta en el issue y el PR
correspondientes. CI no equivale a aprobación clínica, legal ni de privacidad.

## Decisión registrada

- El manifiesto de purga es la **única** fuente de verdad de este ensayo. El
  registro `synthetic_capture_maintenance_events` guarda solo acción y conteo,
  por diseño; por eso el manifiesto se construye a partir del inventario previo
  a la purga (listado de QA de filas vencidas con `id` y `sha256_digest`). No se
  añadieron identificadores ni digests a ese registro para no crear un índice
  histórico de contenido eliminado.
- La copia restaurada debe ser **aislada y desechable**, dentro del mismo
  entorno local/test, y consultarse con un rol **sin RLS de aplicación**. Un rol
  de aplicación se rechaza explícitamente.
- Ningún resultado de este módulo cambia el estado del borrado global: el
  reporte mantiene `global_verified_deletion=false` incluso cuando no observa
  reapariciones.

## Límites explícitos (no resueltos aquí)

- **WAL, archivos de respaldo, instantáneas de almacenamiento, réplicas y
  custodia externa no se inspeccionan.** Un respaldo anterior puede reactivar la
  captura y, mientras eso sea posible, no se declara borrado global verificado.
- La verificación es **manual y puntual**; no hay programación, alerta ni
  integración con el worker de retención.
- La restauración de la copia la ejecuta el operador de QA; el repositorio no
  incluye automatización de `pg_basebackup`/PITR.
- El ensayo cubre `synthetic_capture_objects`; no evalúa almacenamiento de
  objetos S3/MinIO, cachés, registros de auditoría ni el frontend.
- No hay pruebas de carga, ni de concurrencia entre purga y verificación, ni
  sobre PostgreSQL 15 (pendiente de CI).
- Sigue sin haber aprobación clínica, legal, de privacidad ni revisión externa;
  el porcentaje global del proyecto no cambia.
