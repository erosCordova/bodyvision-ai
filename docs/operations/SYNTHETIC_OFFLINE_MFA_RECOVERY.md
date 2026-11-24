# Recuperación asistida de MFA ficticio sin códigos

## Alcance

Procedimiento de mantenimiento fuera de línea para una cuenta ficticia
privilegiada que perdió su autenticador y todos sus códigos de recuperación.
No hay una ruta HTTP para saltarse MFA. Solo admite local/test, organización
sintética, correo `@example.invalid`, cuenta activa con contraseña y un único
rol vigente de administrador o especialista. Exige PostgreSQL por loopback
y el rol migrador local con privilegio de superusuario.

La cuenta debe conservar su contraseña: el procedimiento no la cambia ni
emite sesiones, semillas o códigos. Tampoco cambia roles ni concesiones a
expedientes. Después obliga a inscribir y confirmar otro factor por los
flujos privados ya existentes. La recuperación de contraseñas y la custodia
de claves mantienen sus procedimientos separados.

## Ejecución operativa

El responsable autorizado debe detener los servicios y trabajadores privados,
identificar la cuenta ficticia correcta y asignar un UUID único de revisión.
El módulo rechaza conexiones existentes de los LOGIN estándar
`bodyvision_app` y `bodyvision_auth_app` en esa base. Esa observación es
puntual: no evita que otro proceso se reinicie ni identifica conexiones
privilegiadas que imiten roles mediante SET ROLE. El operador debe mantener
el aislamiento del mantenimiento; no es una prueba de identidad humana.

El módulo es `app.maintenance.recover_synthetic_mfa`, ejecutado con el Python
del backend y `MIGRATION_DATABASE_URL`. Deben estar presentes:

- `APP_ENV=local` o `test`.
- `IDENTITY_ENABLED=true` y `MFA_ENABLED=true`.
- `BODYVISION_ENABLE_MFA_ASSISTED_RECOVERY=synthetic-only`.

La entrada interactiva pide organización, cuenta, referencia UUID única,
la frase `RECUPERAR MFA FICTICIO` y repetir el UUID de la cuenta.
No acepta contraseñas ni semillas en argumentos o entrada. El resultado
no revela tokens, claves, material cifrado ni direcciones de cuenta.
Este documento no inicia el mantenimiento ni actúa sobre instalaciones
del usuario. No se ejecuta contra Neon ni otros hosts externos.

## Transacción y regreso al acceso

1. Bloquea la fila de usuario y el factor confirmado, en el mismo orden
   utilizado por los cambios MFA y la emisión de sesiones.
2. Revoca todas las sesiones anteriores de esa cuenta y elimina su factor;
   los verificadores de recuperación se eliminan por la FK existente.
3. Añade `mfa.recovery_synthetic_offline` a la cadena. El UUID de revisión
   identifica ese evento, con actor nulo (mantenimiento) y recurso usuario;
   no afirma quién hizo una revisión externa. Una referencia repetida falla.
4. Confirma todo junto en la transacción del operador. El savepoint interno
   revierte las mutaciones si falla auditoría, incluso si el llamador atrapa
   la excepción y continúa la transacción exterior.
5. Reabre el servicio con MFA activo. La contraseña sola devuelve
   `MFA_SETUP_REQUIRED`; la inscripción exige la contraseña actual y un
   código válido del nuevo factor antes de emitir una sesión privilegiada.
   Los códigos de recuperación anteriores permanecen invalidados.

## Evidencia

Pruebas de PostgreSQL comprueban el ciclo completo para administrador y
especialista, contraseña/roles/concesiones preservados, revocación de sesión,
factor/códigos antiguos eliminados, nueva inscripción, rechazo de contraseña
errónea y códigos anteriores, referencia no reutilizable y auditoría atómica.
También cubren roles SQL limitados, conexiones runtime, confirmación errónea,
transacción ausente, cuenta deshabilitada, correo excluido, organización
ajena, rol no privilegiado y factor ausente.

Los guardas de entorno y la confirmación interactiva tienen pruebas sin
base de datos. La [CI integral 44979515758](https://github.com/erosCordova/bodyvision-ai/actions/runs/44979515758)
aprobó `5cf834d0575fd9f3b4dfa9c64fafa372d82d4c85` sobre PostgreSQL 15:
**321 backend, 274 frontend, 43 públicas y 9 privadas = 647 pruebas de
aplicación**, además de Windows y Docker. La [retención independiente
44979515719](https://github.com/erosCordova/bodyvision-ai/actions/runs/44979515719)
también aprobó. Los nuevos casos son 11 guardas y nueve integraciones;
el control local suplementario pasó las nueve y 320 backend en PostgreSQL
16, excluyendo solo la aserción de versión 15 que sí aprobó en CI. Solo son pruebas ficticias, no un procedimiento
aprobado para recuperar personas reales ni custodiar claves productivas.
