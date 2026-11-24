# ADR 0002 — Identidad y tenencia

Default aceptado para implementación F2/F3: auth propia argon2id, interfaz IdentityProvider; acceso JWT15min en memoria y refresh rotatorio httpOnly; MFA TOTP obligatorio en roles profesionales; sin registro abierto; invitación/admin y solicitud pendiente. Base compartida con organization_id+RLS y ProfileAccess por expediente. Administrador no obtiene acceso sensible por rol.

En F1 solo se separa rol de migraciones y rol de API. No hay identidad simulada ni encabezado organization_id considerado autenticación. Las tablas de negocio y políticas RLS deberán probarse con conexiones del rol de aplicación, no con superusuario.

## Avance de implementación

La migración 0023 implementa Argon2id y la actualización autenticada de
contraseñas históricas; véase [ADR 0009](0009-argon2-password-transition.md).

El acceso JWT y el refresh rotatorio existen ya como implementación **parcial,
opt-in y solo local/test**:

- access JWT HS256 con vida máxima de 15 minutos, acotada por la expiración de
  la sesión, validado en cada petición contra la sesión viva, su rol y su MFA;
- refresh en cookie `HttpOnly`, `SameSite=Strict` y `Path` acotado, con
  `Secure` bajo https, rotatorio y sin extender la expiración original;
- detección de reutilización desde la migración
  `0026_refresh_session_families`: un refresh ya consumido fuera de una ventana
  breve de concurrencia revoca toda la familia, incluido el sucesor y su JWT, y
  deja auditoría `auth.refresh_reuse_detected`.

Los detalles y sus pruebas están en
[PHASE_3_ROTATING_REFRESH](../qa/PHASE_3_ROTATING_REFRESH.md).

Siguen pendientes: "Recordarme", cierre por inactividad y modal de re-login,
adopción del flujo de cookie por el frontend, recuperación de contraseña
objetivo, invitación por email real, matriz completa de roles, cookie segura
forzada tras terminación TLS, controles externos y revisión independiente.
Todo el conjunto está bloqueado fuera de `local`/`test`; no habilita personas
reales ni cierra la identidad del contrato.
