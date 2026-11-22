# Arquitectura de BodyVision — estado revisado

Revisión: 21 de noviembre de 2026. Esquema privado 0023_argon2_passwords.
La descripción inicial de F2 se conserva en Git; este documento distingue
la implementación actual del objetivo todavía pendiente.

## Flujos actuales

- React/TypeScript/Vite consume FastAPI mediante el cliente API. Nginx expone
  loopback en local; Vite usa proxy durante desarrollo.
- FastAPI usa SQLAlchemy y PostgreSQL; credenciales separadas de migración,
  datos y autenticación, RLS y permisos por organización/expediente.
- Las contraseñas nuevas usan Argon2id; las históricas PBKDF2 se actualizan
  tras autenticación completa, con auditoría y rollback transaccional.
- El modo privado local/test ofrece sesiones opacas, roles, MFA, consentimiento
  ficticio, PNG sintéticos cifrados, resúmenes de pose, mediciones y escenarios
  versionados, PDF/CSV y auditoría.
- MediaPipe/WASM ejecuta la inferencia en el navegador. Los resúmenes declarados
  por el cliente no son inferencia independiente del servidor. Los trabajadores
  existentes cubren retención y vigilancia, no la cola de pose del contrato.
- Three.js conserva el atlas anatómico único y aplica simulaciones sobre ese
  mismo cuerpo. Recursos CPU y emulación no certifican GPU o teléfonos físicos.
- Mantenimiento y recuperación MFA ficticios requieren rol migrador local;
  el restablecimiento fuera de línea no es una ruta HTTP pública.

## Entornos y alojamiento

El proveedor de base alojada acordado es **Neon**, nunca Render. PostgreSQL
local/CI son instancias de prueba aisladas. El modo demo de solo lectura usa
la revisión 0002_data_core; el modo privado usa la revisión de esquema vigente.
Staging y producción continúan bloqueados por configuración.

Readiness comprueba conexión y esquema; liveness no depende de PostgreSQL.
Cada solicitud establece contexto SQL en su transacción; el cliente no ejecuta
SQL y el selector ficticio de organización no constituye una credencial.

## Diferencias respecto al objetivo

El [contrato](../requirements/IMPLEMENTATION_SPEC.md) mantiene la plataforma
para uso real como objetivo. Identidad objetivo/refresh, objetos privados,
cola/worker de pose, solicitudes de privacidad, revisión independiente y
operación productiva no se dan por resueltos mediante sus equivalentes de prueba.
Los ADR iniciales describen objetivos; no prueban que estén implementados.

La [propuesta de fase 0](../qa/PHASE_0_SCOPE_REVIEW.md) registra diferencias y
riesgos para revisión. La [CI 44982522816](https://github.com/erosCordova/bodyvision-ai/actions/runs/44982522816)
aprobó 661 pruebas del código revisado. No certifica el contrato completo.
