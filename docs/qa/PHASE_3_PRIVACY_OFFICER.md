# F3/F9 — Responsable de privacidad con MFA y mínimo dato

Fecha de implementación: 22-11-2026 (Lima). Solo identidades y registros ficticios
local/test. Rama de integración: `feature/phase3-auth-security`.

## Comportamiento

El administrador puede crear una cuenta `privacy_officer` desde Usuarios y
auditoría cuando MFA está activado. La cuenta debe inscribir y confirmar su
propio TOTP antes de recibir una sesión utilizable. Contraseña sola, un bearer
antiguo sin MFA o un token con otra asignación de rol no conceden acceso.
Las invitaciones actuales continúan limitadas a especialista y consulta.
PostgreSQL impide combinar este rol con otro, incluso al insertar asignaciones
directamente. El control bloquea la fila del usuario para serializar cambios:
no depende del orden del selector de roles ni de una validación de interfaz.

| Rol del contrato | Nombre en la implementación |
| --- | --- |
| admin | administrator |
| specialist | specialist |
| end_user | member |
| privacy_officer | privacy_officer |

El permiso de expediente se concede por separado y caduca según el mecanismo
vigente. El rol no hereda acceso de toda la organización:

| Concesión del responsable | Solicitudes | Consentimientos | Datos corporales |
| --- | --- | --- | --- |
| Sin concesión, vencida o revocada | Sin acceso | Sin acceso | Sin acceso |
| read | Consultar cola autorizada | Consultar historial | Sin acceso |
| manage | Consultar e iniciar revisión | Consultar y revocar | Sin acceso |
| write antiguo o insertado fuera del flujo | Solo consulta | Solo consulta | Sin acceso |

La administración rechaza conceder `write` a esta cuenta. El servidor calcula
`can_review` por solicitud; la interfaz deshabilita la acción cuando falta
gestión. Aceptar consentimientos en nombre del titular permanece prohibido,
incluso con gestión. La creación, asignación, lectura de cola, revisión,
consulta/revocación de consentimientos y desactivación siguen las funciones
transaccionales de auditoría existentes.

## Controles y datos expuestos

- La dependencia de acceso de datos limita este rol a la organización actual
  y a la cola/revisión. Consentimientos y seguridad de su propia sesión usan
  sus endpoints privados, con autorización independiente.
- La navegación conduce a Privacidad y Acceso y seguridad. Visitar rutas de
  expedientes o visor redirige a Privacidad; el backend bloquea los endpoints
  de mediciones, capturas, pose, escenarios, reportes y administración general.
- La cola obtiene códigos mediante `private_privacy_profile_labels()`: solo
  ID, organización, código y capacidad de revisión. No consulta expedientes
  clínicos a través del rol de datos ni devuelve nombre, edad o mediciones.
- La migración añade políticas **restrictivas** para el rol `bodyvision_app`
  en perfiles, usuarios, mediciones y claves de idempotencia, escenarios,
  capturas y resúmenes de pose. Impiden leer/escribir datos clínicos también
  fuera del filtro HTTP, aunque exista una concesión amplia antigua.
- La clasificación restrictiva conserva asignaciones de privacidad vencidas;
  caducar el rol no convierte una concesión antigua en acceso clínico.
- El contexto de datos lleva el digest de la sesión verificada en una variable
  local a la transacción. Los permisos de revisor y las etiquetas privadas
  exigen sesión viva, rol actual, identidad verificada y marca MFA en PostgreSQL.
  El digest no se incorpora a respuestas ni eventos de auditoría.
- JWT, rotación, recuperación por código y reemplazo de factor reconocen el
  nuevo rol. Administración puede desactivar/restablecer la contraseña de la
  cuenta; estas operaciones no conceden permisos clínicos. La recuperación
  fuera de línea conserva el control exclusivo del migrador local.

## Migración y compatibilidad

`0030_private_privacy_officer` amplía la restricción de roles y adapta solo
predicados concretos de funciones actuales con comprobación exacta, conservando
Argon2id, inactividad, rotación y auditoría añadidos por migraciones previas.
La API comprueba la revisión `0030`; migración, backend y frontend deben
actualizarse coordinadamente porque el contrato de solicitudes incluye ahora
`can_review`.

El downgrade restaura políticas y funciones anteriores si no existen
asignaciones `privacy_officer`. Si existen, se detiene antes de alterar datos:
no borra cuentas ni las convierte silenciosamente a otro rol. El ensayo
descartable revierte a `0029` y aplica `0030` otra vez tras limpiar sus fixtures.

## Validación

- PostgreSQL local **16** aislado: 14 pruebas aprobadas de solicitudes,
  configuración y los tres nuevos recorridos de privacidad. Se verificaron
  lectura/gestión, concesión `write` antigua, ausencia y revocación de permisos,
  denegación SQL real sobre perfiles/usuarios/mediciones poblados, prohibición
  de INSERT clínico, provisión administrativa con MFA, TOTP, JWT, rotación,
  recuperación de un solo uso y expiración del rol.
- Reversión de `0030` a `0029` y reaplicación aprobadas. Ruff/formato y
  comprobación de revisión de Alembic aprobados.
- 334 pruebas frontend aprobadas, TypeScript, ESLint y build. Las nuevas
  regresiones impiden consultar el directorio clínico desde Privacidad y
  comprueban la navegación limitada del responsable.
- El Chromium local no pudo iniciar por una restricción de sockets del
  entorno. No se atribuye aceptación local de navegador. El nuevo proyecto
  Playwright se ejecuta en CI con MFA y cookies JWT reales, credenciales
  ficticias separadas y trazas, vídeo y capturas desactivados.

CI integral PostgreSQL **15**, Windows/Docker, navegador y retención
independiente aprobaron antes de integrar; la evidencia se registra a continuación. El recorrido nuevo crea la
cuenta y concede gestión desde la UI, inscribe MFA, inicia revisión, revoca un
consentimiento, renueva la cookie HttpOnly y verifica la denegación clínica.

## Alcance pendiente

No se declara atención legal ARCO ni resolución de solicitudes reales,
verificación legal de identidad, borrado de respaldos, revisión independiente
de seguridad o autorización médica. La valoración manual global permanece en
**92,5 % / 93 % mostrado** hasta reevaluar los criterios de cierre de fase.
No hay cambios de `main`, despliegue ni migración de una base alojada; el
proveedor acordado para la base alojada sigue siendo Neon.

## Aceptación e integración — 22-11-2026 (Lima)

El [PR #59](https://github.com/erosCordova/bodyvision-ai/pull/59) se integró en
`feature/phase3-auth-security`, commit
`fc3d0a8a034e3d6705fccd8cb401e164aaf2ca2c`.
La [CI integral #45089842097](https://github.com/erosCordova/bodyvision-ai/actions/runs/45089842097)
aprobó el commit funcional
`ab3a2edb9ded27cd387390edd1d9703d2f716f71`:
**453 backend + 335 frontend + 44 navegador público + 13 navegador privado +
4 cookie + 1 privacidad/MFA = 850 pruebas de aplicación**. No se suman las
repeticiones de Docker ni retención al total. `native-checks`, `windows-scripts`
y `docker-smoke` terminaron en `success`; PostgreSQL 15, migraciones
reversibles, dependencias, compilación y controles de calidad aprobaron.
La [retención independiente #45089842176](https://github.com/erosCordova/bodyvision-ai/actions/runs/45089842176)
aprobó el mismo commit.

El Chromium real confirmó creación y concesión administrativa desde UI,
inscripción TOTP del responsable desde UI, ingreso con segundo factor,
navegación limitada, inicio de revisión con respuesta 200/estado `in_review`,
revocación efectiva de consentimiento, cookie HttpOnly y renovación del rol.
Los endpoints clínicos y de administración devolvieron 403; acceder a las
rutas de expedientes o visor condujo a Privacidad.

La aceptación detectó que los avisos del revisor estaban dentro del formulario
oculto de solicitudes personales. La corrección los sitúa en la zona común y
actualiza solo la cola para este rol; no consulta un historial personal vacío.
La nueva regresión de componente verifica la confirmación visible y ausencia
de peticiones a `/profiles/`; forma parte de las 335 pruebas frontend finales.
Las pruebas SQL verificaron exclusividad de roles en ambos sentidos y
conservación de la denegación clínica con concesiones amplias.

Esto cierra la implementación y aceptación técnica sintética de este rol.
No certifica identidad real, cumplimiento ARCO, seguridad productiva o
recepción formal. El avance global permanece en **92,5 % / 93 % visible**.
