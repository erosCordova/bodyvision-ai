# BODYVISION AI — Formato de exportación en la auditoría privada

## Cambio

Las nuevas exportaciones de comparación PDF registran `report.export.pdf`;
las del historial CSV registran `report.export.csv`. El formato lo decide
la ruta del servidor, sin aceptar una etiqueta del cliente. El ID de la
respuesta identifica ese evento en la cadena de auditoría existente.
No se guardan el archivo, sus valores ni su hash en el evento.

La migración reversible `0022_report_format_audit` incorpora una función
con lista cerrada de formatos y conserva los controles de identidad,
organización ficticia, cuenta activa y concesión vigente al expediente.
Solo el rol de datos puede ejecutar la nueva firma; el rol de
autenticación y PUBLIC carecen de permiso. La firma antigua queda
reservada al propietario y se restaura su concesión al revertir.

Los eventos anteriores `report.export` permanecen intactos y con formato
desconocido. La migración no les atribuye un formato retrospectivo ni
reescribe hashes. Una falla de auditoría continúa impidiendo entregar
los bytes del PDF o CSV.

## Verificación

Las pruebas de API comprueban formato, actor, expediente, ID del evento,
SHA-256 del archivo y rechazo de acceso ajeno. Las regresiones adicionales
verifican una cadena mixta de eventos antiguos/PDF/CSV, el hash antiguo
sin cambios, la comprobación administrativa de integridad, el rechazo
de etiquetas aportadas por el cliente, firmas SQL y permisos, formato
nulo o desconocido y contextos sin verificar o sin acceso al expediente.
Los dos recorridos de fallo transaccional siguen verificando que no se
entregan archivos cuando falla la auditoría.

La validación local suplementaria utiliza un PostgreSQL 16 descartable;
el PostgreSQL 15 fijado del proyecto se verifica en CI. Se comprueba
upgrade/downgrade de la nueva migración y el ciclo completo base/head.
La [CI integral 44975198450](https://github.com/erosCordova/bodyvision-ai/actions/runs/44975198450)
aprobó el commit `92823d4dc7dd04e735244940674673f41532c741`:
**297 backend, 272 frontend, 43 navegador público y 8 privado = 620
pruebas de aplicación**. Windows y Docker finalizaron con `success`,
incluida restauración, MFA, HTTP privado y conservación tras reinicio.
La [retención independiente 44975198474](https://github.com/erosCordova/bodyvision-ai/actions/runs/44975198474)
también aprobó. La comprobación local suplementaria aprobó seis pruebas
específicas y 296 backend, excluyendo solo la aserción de versión 15;
la CI sí aprobó las 297 sobre la versión PostgreSQL 15 fijada.

## Alcance de aceptación

Este cambio completa la distinción auditada de formatos de la fase 7.
Se mantiene su estimación de **90 %** y el global en **90,5 % exacto,
91 % redondeado**. No acredita firma externa, recepción del archivo en
el disco del usuario ni interpretación clínica. Continúan pendientes
los historiales superiores a 500 observaciones y los restantes criterios
de aceptación independiente. Solo expedientes ficticios en local/test.

La reversión de la migración debe acompañarse de la versión correspondiente
del backend; el control de preparación exige la revisión de esquema vigente.
