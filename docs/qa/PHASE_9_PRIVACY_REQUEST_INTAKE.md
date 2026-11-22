# Fase 9 (contrato F9) — Registro y triaje de solicitudes ARCO ficticias

## Implementado

En el entorno local/test con identidad privada optativa:
- Registrar solicitudes de **acceso, rectificación, cancelación, oposición y exportación**
  vinculadas a un expediente al que el usuario tenga permiso explícito de lectura.
- Ver historial paginado, estados `received` e `in_review`, fecha de registro
  y fecha objetivo **interna y ficticia de 7 días** para revisar, no plazo legal.
- Cola administrativa aislada por RLS, sin acceso implícito a expedientes por ser
  administrador. Solo la cuenta administradora con permiso específico de
  escritura puede iniciar el triaje de una solicitud.
- Restricción única de solicitud abierta por expediente y tipo, auditoría
  transaccional append-only, protección por rol SQL y revocación inmediata de
  permisos en la siguiente petición.
- No se reciben nombres, documentos de identidad, imágenes ni texto libre en
  la solicitud. Los cuerpos con campos adicionales son rechazados.

## No implementado ni afirmado

**No se concede el derecho ni se marca como satisfecho con este módulo.**
No se ofrecen transiciones a `completed`, no se borran datos, no se empaquetan
expedientes, no se transmite información al titular y no se valida identidad
legal. La cola no sustituye el rol contractual `privacy_officer`, la
verificación real de representantes, plazos legales revisados, custodia de
respuestas o el flujo de cancelación en copias externas.

Los casos de prueba se realizan con identidades y perfiles ficticios. Esta
función no debe habilitarse en `APP_ENV=production` ni `staging`. No se
modifican `main`, Neon, despliegues ni el modelo anatómico. El porcentaje
global continúa en 93 % hasta una reevaluación sustentada y los criterios
externos de recepción siguen pendientes.

## Verificación y merge de integración — 22-11-2026

El [PR #50](https://github.com/erosCordova/bodyvision-ai/pull/50)
se fusionó en `feature/phase3-auth-security` con el commit
`4845f5e002c3300cdbc81cd61d1efb2733bcb788`,
sobre el código que ya integraba el trabajo de Arena (PR #48) y
la protección de restauración de ChatGPT (PR #49).

La [CI integral #45060607294](https://github.com/erosCordova/bodyvision-ai/actions/runs/45060607294)
aprobó el commit funcional `ac58a218878326427c11ad7fd92957f82f9d5358`:
**438 pruebas backend, 330 frontend, 44 E2E público, 11 E2E privado
y 4 E2E de sesiones cookie: 827 pruebas de aplicación**.
Windows, migración reversible, lint/formato, compilación, Docker,
restauración aislada y pruebas de navegador aprobaron. La
[retención independiente #45060607322](https://github.com/erosCordova/bodyvision-ai/actions/runs/45060607322)
también concluyó exitosamente.

Un ensayo de control detectó que la cola administrativa podía incluir
solicitudes de expedientes sin una concesión explícita. Se corrigió
antes de fusionar, añadiendo comprobación directa de
`profile_access` tanto en la página y total de la API como en
la política RLS y la función privilegiada de auditoría.
La regresión automatizada verifica 0 solicitudes antes de conceder
permiso y 1 después; el administrador sigue sin poder iniciar
revisión hasta contar con permiso de gestión del expediente.

### Criterios aún sin cumplir

La recepción legal ARCO, identidad del titular y representante, respuestas
materiales y cancelación/borrado en copias externas **no se han implementado**.
Esta primera entrega es un registro y triaje **exclusivamente sintético**.
La fase 9 del tablero (operación) no corresponde directamente a F9 del
contrato (privacidad), por lo que **no aumenta automáticamente la media manual
de 92,5 % / 93 % redondeado**. No se fusionó `main`, ni se desplegó.

## Ampliación de navegación y aceptación por navegador (PR pendiente)

Se reemplaza el selector limitado a los primeros 12 expedientes por
búsqueda por código o referencia y páginas de 12 elementos. La cola
identifica cada solicitud con el código del expediente, sin revelar el
nombre del titular ni otros datos personales. La API devuelve ese código
solo tras comprobar el permiso de lectura del expediente, la organización
y el rol; la cola conserva la concesión explícita obligatoria.

El ensayo E2E de Playwright recorre login privado, creación de expediente
ficticio, búsqueda desde la UI, registro de solicitud, bloqueo de duplicados,
revisión administrativa y comprobación del aislamiento de otra organización.

La aprobación no implica atención ARCO legal ni la autorización de datos
reales. El avance de las fases permanece estimado en 92,5 % / 93 % redondeado.
