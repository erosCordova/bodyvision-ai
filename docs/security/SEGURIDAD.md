# Seguridad — implementación y gates pendientes

Revisión: 21 de noviembre de 2026. Acceso privado limitado a datos ficticios
local/test. La habilitación real conserva sus criterios de salida.

## Controles actuales

- Argon2id para contraseñas nuevas y actualización transaccional de hashes
  PBKDF2 históricos solo tras autenticación completa; códigos MFA separados.
  Sesiones opacas revocables y token únicamente en memoria React. Véase
  [ADR 0009](../adr/0009-argon2-password-transition.md).
- Administrator/specialist/member, RLS, concesiones por expediente y aislamiento
  por organización; el administrador no obtiene lectura sensible implícita.
- MFA TOTP/códigos de un uso en modo privado habilitado; semillas cifradas con
  clave externa, reemplazo con código y recuperación ficticia fuera de línea
  para el migrador autorizado.
- Consentimiento ficticio, caducidad/revocación, PNG sintéticos cifrados y
  retención acotada; no habilitan fotografías de personas reales.
- Auditoría append-only encadenada, comprobación administrativa y auditoría
  transaccional en las operaciones y exportaciones implementadas.
- Rate limits, errores/logs sin credenciales, dependencias fijadas y auditadas,
  aislamiento de pruebas y bloqueo preventivo de staging/producción.

## Infraestructura y registro que se conservan

Roles SQL y credenciales de migración/API separados, dependencias con lockfiles,
imágenes Docker fijadas, API/UI sin root y publicación local por loopback.
El contenedor API no debe recibir la credencial propietaria. CORS y hosts son
explícitos y debug permanece deshabilitado.

Los logs omiten excepciones crudas, parámetros SQL y cuerpos. Uvicorn se ejecuta
sin access logs y el registro de acceso Nginx está desactivado. No habilitar
logging SQL o middleware que recoja datos sensibles. Swagger es documentación
local, no evidencia de un endpoint de producción seguro.

El versionado de observaciones, la idempotencia y las restricciones de catálogo
se conservan. El selector ficticio de organización no se reutiliza como identidad.

La [CI 44982522816](https://github.com/erosCordova/bodyvision-ai/actions/runs/44982522816)
es la evidencia integral actual: 661 pruebas de aplicación con su alcance
ficticio. No sustituye una revisión externa de seguridad.

## Diferencias y pendientes

El [ADR 0002](../adr/0002-identity-tenancy.md) plantea Argon2id, JWT y refresh
rotatorio. La contraseña ya usa Argon2id; JWT/refresh sigue pendiente porque
la implementación conserva sesiones opacas. Este documento describe esa
diferencia y no aprueba su equivalencia para el objetivo real.
Invitación, recuperación objetivo y matriz completa de roles
conservan su revisión e implementación pendientes.

Reescribir toda la auditoría y su cabecera requiere una referencia independiente
para detectar la reconstrucción. Anclaje/custodia externos, claves productivas,
borrado de copias, identidad real, privacidad y revisión independiente siguen
abiertos. La cadena actual no es una firma externa. Véase [ADR 0008](../adr/0008-account-security-audit-chain.md). Un modelo de amenazas completo y la revisión externa siguen pendientes.

TLS, cifrado/custodia de discos, backups y objetos, gestor de secretos, gate
granular del contrato, carga y revisión especializada requieren sus pruebas.
Bloquear preventivamente producción no implementa todos esos controles.

La [propuesta de fase 0](../qa/PHASE_0_SCOPE_REVIEW.md) reúne diferencias,
matriz de riesgos y responsables propuestos; su aceptación sigue pendiente.
