# Operación — F1

Uso local y sintético únicamente. `docker compose up --build --wait` ordena DB → migración → readiness API → UI. `docker compose down` conserva volumen. Ver README para desarrollo nativo y controles.

Diagnóstico: si live=200 y ready=503 revisar estado de PostgreSQL y ejecución de Alembic; no volver ready=200 con un valor constante. Si frontend muestra conexión fallida comprobar logs por correlation_id (sin datos personales). Credenciales cambiadas con volumen existente requieren una operación explícita de rotación; regenerar .env no cambia las contraseñas almacenadas. No eliminar el volumen para resolver un problema con datos que se deseen conservar.

Actualizaciones de digests: consultar manifiesto del registro, renovar lockfiles, ejecutar pruebas, construir y escanear imagen y registrar evidencia antes de adoptar. No se han ejecutado escaneos de imágenes sin Docker.

CI: servicio PostgreSQL descartable, pruebas con motor 15, rollback/reaplicación de migración sobre base sin datos personales; builds API/UI; Chromium+axe; smoke Docker con .env aleatorio. El workflow está creado pero su ejecución remota no se presupone.

SLO objetivo del usuario (no medido/aprobado): disponibilidad 99.5%, p95 lectura <500 ms, pose <30 s, RPO15min/RTO4h. No hay promesas de operación productiva en F1. PITR, restauración demostrada, réplicas, alertas, OTel/Prometheus, Sentry con scrubbing y runbooks completos se requieren antes de F9.

## Operación F2

make seed (docker compose run --rm seed) carga exclusivamente fixtures falsos. No se ejecuta al arrancar la API y no sobrescribe registros existentes. El catálogo y dos espacios de desarrollo se crean con la migración. Antes de usar una base de F1 aplicar alembic upgrade head o arrancar Compose. El downgrade destructivo se prueba solo sobre bases de CI/descartables. CI siembra después de comprobar upgrade/downgrade, ejecuta el flujo de datos en navegador y vuelve a probar los contenedores con PostgreSQL real.
