# BODYVISION AI — Invitaciones y matriz de permisos (Fase 3)

## Alcance de esta entrega

Flujo funcional **exclusivamente para PostgreSQL desechable, APP_ENV=local/test
con IDENTITY_ENABLED=true** y direcciones `example.invalid`. No envía correos,
no crea personas reales y no publica un registro abierto. La producción sigue
bloqueada por configuración. La rama no debe fusionarse por completar esta API.

## Ciclo de invitación (migración 0025)

1. Administrador autenticado y con contraseña confirmada crea
   `POST /api/v1/auth/invitations` con correo ficticio, nombre y rol
   `specialist` o `member`. No se admite invitar administradores.
2. El servidor genera un secreto aleatorio de 256 bits y lo devuelve **una
   sola vez**. PostgreSQL solo conserva SHA-256, nunca el código original.
   La duración es de 48 horas y un correo tiene como máximo una invitación
   pendiente por organización. No existe envío automático.
3. El administrador puede revisar `GET /api/v1/auth/invitations` con
   paginación, sin recibir secretos, y revocar
   `POST /api/v1/auth/invitations/{id}/revoke`.
4. El invitado de prueba presenta el código y elige su contraseña mediante
   `POST /api/v1/auth/invitations/accept`. Solo cuando el código está vigente
   se ejecuta Argon2id. La base bloquea la fila de invitación y crea usuario,
   rol, consumo del código y evento de auditoría en **una transacción**.
5. La aceptación no emite sesión ni otorga acceso a expedientes. Para entrar
   debe realizar login y, para cuentas privilegiadas cuando está activado,
   completar MFA. Códigos usados, vencidos o revocados se rechazan.

La creación y aceptación son resistentes al reuso concurrente del mismo
código. Las funciones SECURITY DEFINER están concedidas exclusivamente al
rol de autenticación; tanto `bodyvision_app` como `bodyvision_auth_app`
carecen de acceso directo a la tabla de invitaciones. La organización se
resuelve desde la sesión verificada, no desde cabeceras o el cuerpo.

## Matriz efectiva de roles y acceso

| Operación | Administrador | Especialista | Miembro |
| --- | --- | --- | --- |
| Administrar usuarios/invitaciones | Sí | No | No |
| Leer un expediente | Con permiso de lectura vigente | Con permiso de lectura vigente | Con permiso de lectura vigente |
| Editar un expediente | Con permiso de escritura vigente | Con permiso de escritura vigente | No |
| Capturar imágenes ficticias | Permiso de escritura + consentimiento de captura | Igual | No |
| Ejecutar análisis de pose | Permiso de escritura + consentimiento de pose | Igual | No |
| Leer reportes privados | Permiso de lectura + consentimiento de reporte | Igual | Igual |
| Consultar expedientes de otra organización | No | No | No |

**Un rol no concede automáticamente acceso a ningún expediente.** Se exige
una concesión `profile_access` independiente y vigente, además del
consentimiento para cada finalidad. Toda revocación de permisos o sesiones
surte efecto en la siguiente consulta, incluso cuando se presenta un JWT
válido criptográficamente.

La suite incluye pruebas de invitación única, revocación, expiración,
duplicados, aceptación concurrente, límite organizacional, privilegios SQL,
reautenticación administrativa, y matriz RBAC/consentimiento. No sustituye
la verificación legal de identidad, servicios de correo ni la auditoría
independiente previa al uso de datos médicos reales.
