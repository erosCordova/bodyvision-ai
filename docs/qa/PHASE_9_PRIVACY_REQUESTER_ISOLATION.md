# Fase 9 — Privacidad de solicitudes entre usuarios del mismo expediente

**Fecha de implementación:** 22-11-2026. Solo identidades y datos
**ficticios** del entorno local/test; no habilita cumplimiento legal de
derechos ARCO ni respuestas productivas.

## Defecto corregido

Dos usuarios con permiso de lectura sobre el mismo expediente ficticio
podían consultar el **tipo, estado, fecha y autor** de las solicitudes
de privacidad registradas por el otro. La RLS anterior protegía
organización y concesión por expediente, pero no restringía
estos metadatos al autor de la solicitud. Un expediente compartido
no implica autorización para ver las actuaciones de privacidad
de otros usuarios.

No se infiere exposición de pacientes reales: la funcionalidad está
limitada a identidades y registros sintéticos.

## Política nueva: dos circuitos de lectura

**Historial personal** de
`GET /api/v1/profiles/{profile_id}/privacy-requests`:

- Exige sesión privada, organización y permiso vivo de expediente.
- Las filas y el contador usan también
  `r.requested_by=:actor` en la consulta SQL.
- El usuario ya no ve solicitudes de otros grantees del mismo perfil,
  aunque uno sea especialista y el otro miembro.
- La pantalla identifica este historial como «Mis solicitudes del
  expediente». No expone la identidad de otros solicitantes.

**Cola administrativa** de `GET /api/v1/privacy-requests`:

- Solo rol administrador válido y concesión de acceso vigente al
  expediente; el rol **no otorga acceso implícito**.
- Puede consultar las solicitudes de distintos autores para triaje
  autorizado; el mismo administrador no hereda la vista personal
  de los demás en el historial por expediente.
- Permanecen la auditoría transaccional, paginación y los filtros
  de prioridad interna. No se habilita estado `completed`.

La migración reversible
`0029_privacy_request_owner_isolation` sustituye en PostgreSQL la
política RLS de lectura conservando **identidad verificada, organización,
concesión no vencida y control de perfil**. Añade
`can_view_synthetic_privacy_request(requester_id)`, una función
SQL `SECURITY DEFINER` de retorno booleano y ejecución concedida
solo a `bodyvision_app`. Determina si el actor es quien presentó
la solicitud o un administrador activo, con rol no expirado.
No expone `user_role_assignments` ni se concede su lectura a
la API. `bodyvision_auth_app` no puede ejecutar esta función.

La migración no concede nuevos permisos de escritura y no elimina
solicitudes: las existentes conservan su estado y auditoría. Los
solicitantes dejan de poder consultar retrospectivamente metadatos
ajenos desde el momento de aplicar la política.

## Pruebas que deben aprobar

- Dos actores de un mismo expediente crean solicitudes distintas;
  cada uno lee **solo su solicitud**, su total es 1 y la segunda
  página es vacía.
- Un SELECT directo como `bodyvision_app` y con contexto privado
  del actor comprueba que la **RLS**, sin el filtro HTTP, también
  excluye la solicitud de otra persona.
- El administrador sin concesión no ve ninguna solicitud ni en
  historial ni en cola.
- Con concesión de gestión, la cola administrativa ve y pagina las
  dos, pero el historial personal del administrador sigue vacío.
- El administrador inicia triaje de una solicitud sin cambiar la
  propiedad o exponer otra solicitud en el historial del miembro.
- El rol de autenticación no obtiene ejecución de la nueva función.
- Se mantienen aislamiento interorganizacional, rechazo de duplicados,
  CI de Windows/Docker, navegador privado y política de retención.

## Puertas aún abiertas

No existen identidad legal verificada, ejecución material de derechos
ARCO, custodia externa, supresión de respaldos, autorización para
datos clínicos o aceptación de un responsable de privacidad.
Por ello este cierre corrige el **control de acceso**, no resuelve
peticiones legales. No se fusiona `main` ni se despliega a producción.
El porcentaje global se mantiene en **92,5 % (93 % mostrado)**
hasta nueva reevaluación con criterios de aceptación completos.

## Evidencia ejecutada e integración — 22-11-2026

El [PR #57](https://github.com/erosCordova/bodyvision-ai/pull/57)
se fusionó en la rama de integración compartida con commit
`85ab7f345229c98a1849b6e03b229ed10f123160`.
El commit validado
`d8c80687471a6e96447820c6584b3de204ca3292`
superó la
[CI integral #45082050616](https://github.com/erosCordova/bodyvision-ai/actions/runs/45082050616):
**442 backend + 331 frontend + 44 navegador público +
13 navegador privado + 4 cookie = 834 pruebas de aplicación**.
Los jobs `native-checks`, `windows-scripts` y
`docker-smoke` acabaron en `success`. La
[retención de pose independiente #45082050639](https://github.com/erosCordova/bodyvision-ai/actions/runs/45082050639)
también terminó en `success`.

La prueba integrada de dos usuarios con acceso al mismo perfil
confirmó una solicitud visible para cada autor, ninguna
metainformación ajena y un recuento de 1 para cada historial
personal. Se repitió la lectura **directamente mediante el rol
SQL restringido `bodyvision_app`**, fuera del filtro HTTP,
y se observó una sola solicitud. La cola, con administrador y
permiso explícito, conservó acceso a ambas solicitudes, incluido
el inicio de revisión sin modificar la autoría. El rol de
autenticación no recibió el privilegio de ejecutar el evaluador
de visibilidad.

El primer intento de CI detectó que el identificador de Alembic
superaba la longitud de la columna de revisiones. Un segundo
intento señaló formato Ruff. El tercero reveló que la comprobación
de salud esperaba todavía `0028` al haber avanzado a `0029`,
por lo que operaciones daba `unavailable` y Docker marcaba
el backend `unhealthy`. Se corrigieron las tres causas sin
debilitar la autorización y el cuarto run integral aprobó.
La constante de contrato es ahora
`SCHEMA_REVISION="0029_privacy_request_isolation"`.

**Límites sin cambios:** tests con cuentas y datos sintéticos,
no atención legal de ARCO, no validación de identidad real,
sin datos médicos de pacientes, ni firma o recepción de privacidad.
`main` y despliegue productivo intactos. Por ser el cierre de
una falla funcional específica y no de los gates externos de
fase, la estimación global manual continúa en **92,5 % /
93 % visible**.
