# BODYVISION AI — Fase 3 (fundación de identidad y consentimiento)

## Objetivo y estado

Esta rama contiene **solo la base segura de datos y las políticas del dominio**.
**No habilita inicio de sesión real, no incorpora cuentas de usuarios reales ni
abre operaciones clínicas.** La demostración pública permanece con datos
sintéticos y de solo lectura. No fusionar esta fase como «seguridad completa».

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
- Tokens de sesión aleatorios con persistencia únicamente de su hash; emisión
  y validación HTTP todavía pendientes.
- Comprobación de consentimiento por finalidad, vigencia y revocación.
- Nuevas tablas **sin permisos** para `bodyvision_app`. Se establecerá
  posteriormente un rol de base de datos específico para autenticación y
  consentimiento, previa revisión de privilegios.

## Siguiente incremento antes de activar el login

1. Provisionamiento administrativo con credenciales y rotación; recuperación
   de cuentas protegida contra enumeración.
2. Endpoints para login/logout, expiración y renovación controlada de sesión.
3. Vincular las sesiones verificadas a cada solicitud. El header de selección
   de organización de la demo **no** puede otorgar permisos reales.
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
