# Fase 3 — Expiración por inactividad verificable (local/test)

Este incremento completa un **cierre automático de la sesión privada por
15 minutos sin interacción**, para cuentas y expedientes ficticios. El servidor
impone el límite; el frontend no lo determina por sí solo. No admite uso
clínico, cuentas reales ni despliegue productivo.

## Reglas de seguridad

- Migración `0027_private_idle_activity`: fecha de última interacción
  autenticada por sesión. Las sesiones históricas usan su fecha de emisión
  como primera referencia (no se reactivan gratuitamente).
- `resolve_authenticated_session` rechaza sesiones inactivas desde hace
  15 minutos, además de conservar el vencimiento absoluto de ocho horas,
  la revocación, el rol y las comprobaciones MFA existentes.
- Un trigger obligatorio conserva `last_activity_at` al rotar el refresh
  dentro de la misma familia. La renovación automática de JWT o cookie
  **no cuenta** como interacción de una persona y no prolonga la ventana.
- `POST /api/v1/auth/activity` requiere el JWT/bearer de la sesión real,
  nunca acepta un refresh cookie como autorización. Actualiza solo la
  sesión activa y no permite reactivar una sesión caducada. El rol de datos
  no recibe acceso a la nueva columna ni al procedimiento de actualización.
- La interfaz privada detecta teclado, pulsación y toque. Reduce los
  avisos al servidor a uno por minuto como máximo y programa el bloqueo
  local a los 15 minutos; tras suspensión del equipo verifica el tiempo
  antes de admitir una nueva pulsación. Un 401 del heartbeat termina la
  sesión local, limpia la caché y trata de revocar el refresh.
- La aplicación muestra una notificación de sesión cerrada por inactividad,
  y solicita iniciar sesión nuevamente. Los tokens siguen solo en RAM y
  la cookie sigue HttpOnly; no se utilizan `localStorage` ni
  `sessionStorage`.

## Evidencia y límites

Pruebas de integración con PostgreSQL ficticio: actualización permitida,
expiración, imposibilidad de revivir la sesión, preservación de actividad
tras refresh y rechazo de JWT revocado por inactividad.

Pruebas de frontend: regreso después de una suspensión, heartbeat con
bearer sin cookie como identidad, expiración sin interacción y cierre ante
401 de servidor.

**Queda pendiente** una experiencia de reidentificación modal que preserve
un formulario parcialmente completado, la política de inactividad
configurable por organización y la revisión independiente. No se declaran
satisfechos esos requisitos por este incremento. Producción permanece
bloqueada; ninguna prueba simula que hubo autorización clínica.
