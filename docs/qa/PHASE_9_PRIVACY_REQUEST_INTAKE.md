# Fase 9 (contrato F9) — Registro y triaje de solicitudes ARCO ficticias

## Implementado

En el entorno local/test con identidad privada optativa:
- Registrar solicitudes de **acceso, rectificación, cancelación, oposición y exportación**
  vinculadas a un expediente al que el usuario tenga permiso explícito de lectura.
- Ver historial paginado, estados \`received\` e \`in_review\`, fecha de registro
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
No se ofrecen transiciones a \`completed\`, no se borran datos, no se empaquetan
expedientes, no se transmite información al titular y no se valida identidad
legal. La cola no sustituye el rol contractual \`privacy_officer\`, la
verificación real de representantes, plazos legales revisados, custodia de
respuestas o el flujo de cancelación en copias externas.

Los casos de prueba se realizan con identidades y perfiles ficticios. Esta
función no debe habilitarse en \`APP_ENV=production\` ni \`staging\`. No se
modifican \`main\`, Neon, despliegues ni el modelo anatómico. El porcentaje
global continúa en 93 % hasta una reevaluación sustentada y los criterios
externos de recepción siguen pendientes.
