# Fase 3 — Rotación fuera de línea de claves TOTP ficticias

Estado: **validación automatizada integral aprobada** en la ejecución
[44827504437](https://github.com/erosCordova/bodyvision-ai/actions/runs/44827504437).
No se ha ejecutado una rotación sobre datos reales.
No es un sistema de gestión de claves para pacientes ni autoriza producción.

## Procedimiento y controles

Se añadió el módulo restringido
`python -m app.maintenance.rotate_synthetic_mfa_key`. Solo puede utilizarse
con PostgreSQL local en loopback y rol migrador superusuario, después de
detener todas las API privadas y verificar un respaldo cifrado externo.

La operación exige `APP_ENV=local|test`, `IDENTITY_ENABLED=true`,
`MFA_ENABLED=true`, `BODYVISION_ENABLE_MFA_KEY_ROTATION=synthetic-only`,
`MIGRATION_DATABASE_URL` local, y dos secretos **diferentes** guardados
fuera del repositorio: `MFA_ROTATION_OLD_KEY` y `MFA_ROTATION_NEW_KEY`.
La consola pide confirmación doble; los secretos **no** se transmiten como
argumentos ni se imprimen en logs.

La transacción toma bloqueo exclusivo de la tabla de credenciales MFA,
verifica que toda organización tenga `synthetic=true`, rechaza sesiones
MFA aún vigentes y **descifra primero todas las semillas con la clave
anterior**. Si alguna es ilegible, aborta sin actualizar ninguna.
Después cifra cada semilla usando la clave nueva, verifica los valores
almacenados y añade un evento `mfa.key_rotated_synthetic` por organización
a la cadena de auditoría. Todo se confirma o revierte atómicamente.

Después de confirmar, la operación humana debe actualizar
`MFA_ENCRYPTION_KEY` en el gestor de secretos *antes* de reiniciar la API
privada, y conservar la clave anterior bajo custodia hasta verificar login
MFA y capacidad de recuperación de desastre. Este proceso NO cambia los
códigos de recuperación ni el contador TOTP; ambos conservan su validez.
No se cambian rutas HTTP ni se migran bases alojadas.

## Pruebas de aceptación

`backend/tests/integration/test_mfa_key_rotation.py` verifica el bloqueo
de demo/producción/host remoto, rechazo de claves inválidas, recifrado
de dos organizaciones sintéticas, imposibilidad de descifrar con la clave
antigua, auditoría y fallo cerrado ante una semilla corrupta. Todos los
datos viven en una transacción de test que se revierte.

## Bloqueos que persisten

Todavía hace falta: un procedimiento probado de respaldo/restauración
de la **clave** cifrante fuera del sistema; aprobación humana para cada
rotación; respaldo anterior verificado; custodia externa de secretos;
operación segura de parada/reinicio y validación real de pérdida de acceso.
Esta utilidad **nunca debe ejecutarse** sobre Neon ni sobre datos de
personas reales. No es rotación sin downtime.
