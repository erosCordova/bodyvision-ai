# BODYVISION AI — Fase 3 (fundación de identidad y consentimiento)

## Objetivo y estado

Esta rama contiene **solo la base segura de datos y las políticas del dominio**.
**El nuevo API privado de login solo se activa explícitamente en local/test; no
incorpora cuentas reales ni abre operaciones clínicas.** La demostración pública
permanece sintética y de solo lectura. No fusionar como «seguridad completa».

## Entregas de esta iteración

- Migración `0003_identity_foundation`: usuarios con email y hash de contraseña
  opcionales (los operadores de prueba existentes quedan deshabilitados para
  autenticación), roles por organización, sesiones opacas con digest SHA-256,
  consentimiento versionado por finalidad y auditoría mínima sin payload clínico.
- Políticas de acceso de **denegación por defecto**: un administrador no puede
  consultar un expediente sin un permiso explícito; los miembros no pueden
  modificar expedientes ni ejecutar captura/IA.
- Verificación de contraseña con PBKDF2-HMAC-SHA256 y sal aleatoria, sin guardar
  contraseñas en texto plano. El esquema deberá revisarse frente a los
  requisitos de seguridad vigentes antes de producción.
- Tokens opacos con persistencia solo de hash; el API privado comprueba credenciales,
  crea/revoca sesiones y devuelve el rol verificado. Un selector de organización
  no se acepta como identidad en modo protegido.
- Rol PostgreSQL separado para autenticación; el rol de datos pierde permiso
  para consultar contraseñas cifradas.
- Comprobación de consentimiento por finalidad, vigencia y revocación.
- Nuevas tablas **sin permisos** para `bodyvision_app`. Se establecerá
  posteriormente un rol de base de datos específico para autenticación y
  consentimiento, previa revisión de privilegios.

## Siguiente incremento antes de activar el login

1. Provisionamiento administrativo verificado y recuperación segura de cuentas.
2. Rate limiting distribuido, MFA, renovación y protección contra sesiones robadas.
3. Integración de frontend autenticado y revisión de almacenamiento de sesiones.
4. Controles por expediente en API y políticas RLS, con pruebas de acceso
   cruzado y de consentimiento revocado.
5. Cifrado de datos privados, almacenamiento de capturas con autorización,
   rate limiting, auditoría verificable, revisión legal y respaldo seguro.

## Regla de despliegue

Los cambios se proponen en una **rama de desarrollo**, con solicitud de
cambios en borrador. No se fusionan a `main` ni se publican en Vercel/Render
hasta que se prueben y se apruebe un entregable suficientemente completo.

**Fuente de requisitos:** documentación BODYVISION v3, Fase 3 (Seguridad e
identidad), modelo funcional de usuarios/roles/consentimientos y criterios de
salida; documentación v2, capítulos 4, 11 y 12.

## API de pruebas, sin publicación

En un entorno local o CI aislado con PostgreSQL, las variables
IDENTITY_ENABLED=true y AUTH_DATABASE_URL habilitan un rol de autenticación
separado. No se habilitan en demo, staging ni producción.

- POST /api/v1/auth/login: sesión solo de cuentas ficticias provisionadas.
- GET /api/v1/auth/me: identidad y rol de la sesión activa.
- POST /api/v1/auth/logout: revocación de sesión.

En modo protegido los endpoints de expedientes obtienen organización y actor
de la sesión verificada, no de X-Workspace-ID. Las políticas PostgreSQL RLS
y las concesiones profile_access limitan las filas; los miembros tienen
acceso de lectura, no de edición. El resumen aplica los mismos límites.

Faltan alta verificada, tasa máxima de intentos, MFA, controles del frontend,
auditoría integral y consentimiento en futuras API de captura y pose.
Datos reales no admitidos. No fusionar ni desplegar sin aceptación de fase 3.