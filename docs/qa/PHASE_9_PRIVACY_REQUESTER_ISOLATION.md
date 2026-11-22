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
