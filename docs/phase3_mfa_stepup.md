# BODYVISION AI — MFA de cuentas privilegiadas (incremento F3)

## Alcance y límites

Esta implementación es **experimental, optativa y exclusiva de cuentas ficticias
en local/test**. La demostración pública continúa sin permitir sesiones privadas,
capturas de pacientes ni datos médicos reales. Mantener el PR en borrador.

Con `IDENTITY_ENABLED=true` y `MFA_ENABLED=true`:
- Los administradores y especialistas requieren segundo factor para crear sesiones.
- Los usuarios `member` conservan el acceso por contraseña, según el alcance actual.
- Las sesiones antiguas de administradores y especialistas, sin prueba MFA, se
  rechazan en los endpoints privados aunque el token siga vigente.
- Una sesión y su marcador MFA se confirman en la misma transacción que consume
  el paso TOTP o el código de recuperación.
- La demostración pública y despliegues reales **no** habilitan MFA ni la API
  privada, aun si se configuran variables incorrectamente.

## Configuración de prueba

Generar una clave Fernet única, aleatoria, fuera del repositorio; conservarla
en el almacén de secretos del entorno. Debe ser una clave URL-safe Base64
de 32 bytes (cadena codificada de 44 caracteres). **No usar ni publicar la
misma clave para entornos diferentes.** En local/test configurar:

```dotenv
IDENTITY_ENABLED=true
MFA_ENABLED=true
MFA_ENCRYPTION_KEY=<clave-Fernet-privada>
AUTH_DATABASE_URL=<url-de-rol-bodyvision_auth_app>
```

Sin clave válida, el arranque debe fallar. La configuración de MFA es optativa
para conservar las pruebas de regresión existentes; su habilitación se verifica
mediante pruebas específicas. No activar MFA solo en el frontend.

La clave cifrante no se registra en el código ni en la base. Su pérdida hace
irrecuperables las semillas TOTP almacenadas; antes de producción falta definir
rotación de claves, depósito y recuperación administrativa.

## Flujo de activación y autenticación

1. La cuenta privilegiada inicia con credenciales correctas; si no configuró
   el segundo factor, `POST /api/v1/auth/login` rechaza el acceso con
   `428 MFA_SETUP_REQUIRED`. No se persiste token alguno.
2. `POST /api/v1/auth/mfa/enrollment` comprueba nuevamente la contraseña,
   limita intentos en PostgreSQL y devuelve un URI `otpauth://`. El usuario
   añade manualmente la semilla en una aplicación autenticadora. El servidor
   solo conserva el secreto cifrado.
3. `POST /api/v1/auth/mfa/confirm` comprueba el código de seis dígitos y
   finaliza la inscripción; emite la sesión junto con ocho códigos de
   recuperación que se muestran **una sola vez**. La contraseña y los códigos
   no se persisten en el navegador.
4. Los siguientes inicios de sesión usan `mfa_code`, con un TOTP nuevo o un
   código de recuperación no utilizado. Los códigos TOTP aceptan una ventana
   de un período hacia adelante/atrás y nunca admiten un contador previamente
   consumido. El reemplazo de una semilla confirmada está bloqueado.
5. PostgreSQL serializa la aceptación del paso TOTP o la marcación del código
   de recuperación como consumido. Los contadores de intentos sobreviven a
   reinicios y a múltiples instancias del API.

## Controles de seguridad

- Semillas TOTP cifradas mediante Fernet; códigos de recuperación de 128 bits
  con verificadores PBKDF2-HMAC-SHA256 salados.
- Tablas con Row Level Security y sin SELECT/INSERT/UPDATE/DELETE directos
  para `bodyvision_app` ni `bodyvision_auth_app`.
- Funciones SQL SECURITY DEFINER de permisos explícitos, con operaciones
  acotadas a organizaciones sintéticas y cuentas activas verificadas.
- Verificación de MFA antes de devolver tokens privilegiados, incluso con
  solicitudes concurrentes, y validación de marcador MFA en sesiones existentes.
- Auditoría del inicio de inscripción, confirmación, uso de TOTP y consumo de
  recuperación, sin guardar el código ni la semilla.
- Migraciones hasta `0015_mfa_recovery_reset`, reversibles solo en bases
  desechables de pruebas.

## Recuperación de autenticador extraviado (cuentas ficticias)

La recuperación nunca se basa únicamente en contraseña ni en un enlace enviado
al correo electrónico. Requiere **contraseña actual + un código de recuperación
válido y no utilizado**:

1. Desde la pantalla de acceso, elegir «Perdí el acceso a mi autenticador»;
   introducir la organización, correo, contraseña y un código de recuperación.
2. `POST /api/v1/auth/mfa/recover` verifica las credenciales, aplica el mismo
   limitador persistido que el inicio de sesión y valida el verificador salado
   del código. No admite restablecer factores para perfiles sin MFA confirmado.
3. La función `private_mfa_reset_with_recovery` bloquea la fila del usuario
   para serializarse con los inicios de sesión. Verifica que el código continúa
   disponible, consume el código, revoca **todas** las sesiones, elimina los ocho
   verificadores anteriores y establece una semilla TOTP nueva como `pending`.
   Todo esto y el evento de auditoría se confirman **en una sola transacción**.
4. Se devuelve el nuevo URI `otpauth://` solo después de una transacción
   confirmada. Hasta completar `/mfa/confirm` con el nuevo TOTP, la cuenta
   privilegiada no puede obtener una sesión. La confirmación emite ocho códigos
   de recuperación nuevos; se muestran una sola vez.
5. Si la persona **perdió tanto su autenticador como todos los códigos de
   recuperación**, el sistema falla cerrado y no ofrece recuperación por
   contraseña. Se requiere un proceso de verificación de identidad asistido,
   documentado y auditado, todavía no implementado.

Este mecanismo no permite al administrador crear, editar ni recuperar factores
de terceros mediante un selector de cuenta arbitrario. Las peticiones están
ligadas a las credenciales del propio usuario dentro de su organización
sintética.

## Custodia y rotación de la clave cifrante

La semilla TOTP se cifra mediante la clave `MFA_ENCRYPTION_KEY` externa.
**No** sustituir dicha clave mientras existan semillas cifradas con ella:
las cuentas perderían su autenticación de dos factores. La rotación real
requiere un flujo transaccional de recifrado por lotes, auditoría, respaldo
cifrado y verificación de rollback; aún no existe. Está prohibido introducir
la clave en el repositorio, en logs, o en capturas de interfaz.

## Alta administrativa inicial

El alta inicial de un administrador **no** se expone como endpoint de
autoregistro. Las cuentas de prueba se provisionan solamente en la base
desechable del CI, y la API de provisión de usuarios no puede otorgar el
rol `administrator`. La identidad legal y autorización del primer
administrador de una organización real deberán verificarse por un proceso
externo aprobado antes de habilitar el sistema en producción.

## Pendiente antes de producción

**No considerar la seguridad clínica completa.** Falta un mecanismo verificable
de alta inicial del administrador, recuperación asistida sin códigos de respaldo, notificaciones de seguridad,
pruebas de amenazas de la implementación TOTP en navegador, privacidad y
cumplimiento legal, continuidad de claves y recuperación ante desastre.

El registro inicial con solo contraseña es adecuado únicamente para cuentas
ficticias ya provisionadas en un entorno controlado. No sirve como método
independiente de enrolamiento para usuarios médicos reales.
