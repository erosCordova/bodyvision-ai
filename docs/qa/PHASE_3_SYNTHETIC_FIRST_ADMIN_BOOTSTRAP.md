# Fase 3 — Primer administrador sintético (alta local controlada)

**Estado:** herramienta y pruebas de integración añadidas; verificar el resultado
de CI antes de marcar el gate técnico. **No es alta real ni aprobación de
identidad, ni habilita producción.** No existen credenciales predeterminadas.

## Alcance

La herramienta `python -m app.maintenance.bootstrap_synthetic_admin` solo
admite PostgreSQL por loopback, esquema migrado, un rol migrador
privilegiado y `APP_ENV=local|test`, `IDENTITY_ENABLED=true`, junto con
`BODYVISION_ENABLE_BOOTSTRAP=synthetic-only`. Lee exclusivamente la URL
privilegiada `MIGRATION_DATABASE_URL`; no acepta contraseñas como opciones
de terminal ni por variables. Exige confirmación literal e introduce la
contraseña dos veces mediante entrada interactiva oculta.

Solo crea la **primera** cuenta de administrador de una organización
existente marcada `synthetic=true` en PostgreSQL. Su correo pertenece
obligatoriamente al dominio reservado `@example.invalid`. No permite
crear más administradores ni reutilizar una organización que ya tenga
alguna asignación de ese rol, aunque esa cuenta esté deshabilitada.
Bloquea la fila de la organización antes de comprobar la unicidad, de
manera que dos operaciones concurrentes no creen dos administradores.

En una sola transacción registra el usuario activo con PBKDF2 salado,
el rol inicial y un evento `admin.bootstrap_synthetic`, con secuencia y
hash de la cadena de auditoría. No guarda contraseñas, códigos ni tokens
en la auditoría. Un error o cancelación aborta todas las escrituras.

## Pruebas

`backend/tests/integration/test_first_admin_bootstrap.py` verifica en
PostgreSQL aislado: formato y dominio de credenciales; prohibición de
entornos demo/staging/producción y hosts no locales; generación del
verificador; asignación de rol; secuencia y hash del evento; rechazo de
la segunda alta y de organizaciones inexistentes. Todas las pruebas
revierten la transacción y no dejan credenciales en la base.

## Lo que sigue pendiente

La herramienta no verifica la identidad legal de un administrador real,
no permite recuperar una organización cuyo único administrador haya
perdido el acceso y no sustituye MFA, custodia de claves, seguridad de
red ni autorización explícita de producto. Un alta real requerirá un
proceso de identidad externo y auditado, con aprobación y operación
documentadas. La demo pública de Neon no debe ejecutar esta herramienta.
