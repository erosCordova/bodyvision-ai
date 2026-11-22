# F2 — Aislamiento explícito del directorio de expedientes ficticios

**Alcance:** entornos `local/test` con PostgreSQL y datos sintéticos.
La implementación no habilita pacientes reales ni modifica `main`.

## Hallazgo y objetivo

La política RLS `profile_read` ya exige
`has_profile_access(id)` al leer la tabla `profiles`, por lo que
**no hay evidencia de una filtración previa** al listar expedientes.
Sin embargo, el endpoint `GET /api/v1/profiles` no aplicaba por
sí mismo el filtro explícito de concesiones y vencimiento. El criterio
R6 exige **dos capas independientes**: predicado en consultas y RLS.

Además, el parámetro de búsqueda se pasaba a `ILIKE` sin escapar
`%` ni `_`. Son comodines de SQL y expandían el resultado de
búsqueda, incluso cuando el usuario pretendía buscar un carácter
literal; los resultados seguían sujetos a la RLS existente.

## Implementación

- `list_profiles` aplica `has_profile_access(id)` dentro de la
  condición de **filas y total**. No depende solamente de la RLS.
- El parámetro de búsqueda se trata como una **subcadena literal**,
  escapando `%`, `_` y barra invertida antes de construir el patrón.
  La consulta mantiene valores parametrizados: no concatena SQL.
- Se conservan orden, limitación `1–100`, offset, contratos JSON,
  auditoría transaccional y acceso de demostración.
- Ningún rol obtiene acceso implícito por ser administrador; se requiere
  concesión de perfil individual y no expirada.
- Las escrituras, visualizaciones y el modelo 3D quedan sin cambios.

## Aceptación requerida

Una prueba con PostgreSQL real y cuentas de distintas organizaciones
verifica que el especialista y el miembro con concesión ven solo su
expediente; el administrador sin concesión y el usuario de otro tenant
no ven ni filas ni total. La paginación conserva el total autorizado.
Se comprueba búsqueda sin distinguir mayúsculas y que `%`, `_` y
barra invertida se interpretan literalmente.

El mismo miembro mantiene su sesión autenticada después de simular
el vencimiento de su concesión, pero pierde inmediatamente el perfil
y el total del directorio. Al renovar la concesión reaparece, y tras
revocarla desde el endpoint administrativo desaparece de nuevo sin
desconectar la sesión. Todo ello se verifica por HTTP real.

La prueba Playwright privada existente, que crea una cuenta ficticia
y concede/revoca acceso desde la interfaz, incorpora comprobaciones
expresas de `GET /profiles` antes, durante y después de la concesión.

## Limitaciones

Este cierre refuerza autorización y búsqueda de F2, pero no sustituye
evaluación independiente de seguridad y privacidad, aceptación legal
de consentimiento, custodia externa, backups ni pruebas físicas.
El porcentaje manual permanece en **95 % F2** y **92,5 % global
(93 % visible)** hasta contar con criterios de cierre adicionales
verificados. No se modifican objetivos productivos ni despliegues.

## Evidencia de aceptación técnica en CI — 22-11-2026

El [PR #56](https://github.com/erosCordova/bodyvision-ai/pull/56)
fue fusionado en la rama de integración compartida con el commit
`62de79c6934a5f4aae59457e191bfc09c8e10b18`.
La [CI #45079872903](https://github.com/erosCordova/bodyvision-ai/actions/runs/45079872903)
aprobó el commit de PR
`756a457b228d17bad9f50a4314e79c55fbc85013`:
**441 backend + 331 frontend + 44 públicas + 13 privadas +
4 cookies = 833 pruebas de aplicación**. Los jobs
`native-checks`, `windows-scripts` y `docker-smoke`
finalizaron `success`; además pasaron migraciones, compilación,
aceptación HTTP/navegador, restauración aislada y seguridad de
sesión. La
[retención independiente #45079872864](https://github.com/erosCordova/bodyvision-ai/actions/runs/45079872864)
terminó `success`.

El primer intento del PR falló antes de pruebas funcionales
por dos líneas con formato Ruff incorrecto. Se corrigieron según
su formateador y el run posterior aprobó todos los trabajos.
No hubo cambios de dominio como respuesta a ese error.

La prueba F2 valida que el listado, la búsqueda y el contador
no revelan expedientes sin concesión vigente; la sesión sigue
válida después de vencer o revocar el permiso. El navegador
privado comprobó explícitamente el recuento `0→1→0`
durante concesión y revocación.

**No se ha documentado ni inferido una filtración anterior:**
la RLS ya restringía los expedientes. La nueva condición SQL
constituye defensa en profundidad independiente y protege
el contrato de búsqueda literal. F2 sigue en 95 % y el
global estimado en 92,5 % (93 % visible): faltan aceptación
independiente formal, permisos legales y operación externa.
Sin merge a `main`, despliegue ni datos clínicos reales.
