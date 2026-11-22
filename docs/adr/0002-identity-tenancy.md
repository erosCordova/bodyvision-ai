# ADR 0002 — Identidad y tenencia

Default aceptado para implementación F2/F3: auth propia argon2id, interfaz IdentityProvider; acceso JWT15min en memoria y refresh rotatorio httpOnly; MFA TOTP obligatorio en roles profesionales; sin registro abierto; invitación/admin y solicitud pendiente. Base compartida con organization_id+RLS y ProfileAccess por expediente. Administrador no obtiene acceso sensible por rol.

En F1 solo se separa rol de migraciones y rol de API. No hay identidad simulada ni encabezado organization_id considerado autenticación. Las tablas de negocio y políticas RLS deberán probarse con conexiones del rol de aplicación, no con superusuario.

## Avance de implementación

La migración 0023 implementa Argon2id y la actualización autenticada de
contraseñas históricas; véase [ADR 0009](0009-argon2-password-transition.md).
Las sesiones siguen siendo opacas: JWT de acceso y refresh rotatorio
conservan su implementación pendiente. Este avance no cierra toda la identidad
del contrato ni habilita personas reales.
