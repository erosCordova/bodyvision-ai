# Fase 7 — PDF de comparación generado por el servidor

En Expedientes → Evolución del espacio privado de pruebas, «Descargar informe
PDF» entrega un PDF A4 con el código del expediente, métrica/unidad, fechas en
Lima, valores, diferencia absoluta/relativa, UUID de ambas fuentes, fecha de
consulta e identificador de informe. La demostración pública conserva la
impresión local existente.

## Procedencia y autorización

`POST /api/v1/profiles/{profile_id}/reports/comparison` recibe exclusivamente
los dos UUID de medición. El servidor obtiene los valores de PostgreSQL y
comprueba el acceso vigente al expediente y la organización ficticia. Una
consulta única lee ambas fuentes y su estado vigente en la misma instantánea.
Se rechazan fuentes ausentes, sustituidas, ajenas, de métricas distintas,
fechas invertidas o iguales e identificadores duplicados. Una corrección
posterior puede sustituir una fuente sin cambiar los valores del PDF emitido.
No se leen escenarios ni se aceptan valores o etiquetas del cliente.

La migración `0019_comparison_export` añade una función SQL restringida al rol
de datos que verifica identidad activa, organización sintética y permiso de
lectura vigente. Registra `report.export` en la cadena de auditoría, con el
identificador del informe como ID de evento y el expediente como recurso.
La transacción debe confirmarse antes de entregar la respuesta. Un fallo de
auditoría impide descargar el PDF. No se guardan valores ni el PDF en auditoría.

## Integridad y límites

El cliente comprueba la cabecera PDF y SHA-256 de los bytes entregados antes
de crear una descarga temporal; no conserva el PDF en almacenamiento del
navegador. Las respuestas llevan `Cache-Control: no-store`. Cambiar selección
o salir descarta las respuestas tardías. La huella viaja en la misma respuesta:
comprueba integridad de entrega, **no acredita autoría ni firma digital**.
No existe archivo de PDFs, firma, certificación, registro de descarga terminada
ni verificación externa del checksum. La auditoría registra generación autorizada.

La salida es de texto acotado, una página, sin JavaScript, enlaces, adjuntos,
imágenes ni dependencias PDF nuevas. Los literales se escapan y se codifican
en WinAnsi para español. El contenido es descriptivo y exclusivamente ficticio.
No habilita producción ni datos personales reales.

## Verificación

- Unitarias Python: estructura/xref del PDF, texto español, escape de literales,
  cálculos y zona horaria.
- PostgreSQL: lectura autorizada, aislamiento de organización, fuentes vigentes,
  rechazo de cambios de valores enviados por cliente, evento confirmado y fallo
  cerrado si falla la auditoría.
- Frontend: verificación de bytes/huella, rechazo de contenido alterado, nombre
  de archivo acotado y errores de autorización.
- Navegador privado: crea dos observaciones ficticias, descarga desde Evolución,
  comprueba fuentes y checksum y localiza el evento de auditoría.

La ejecución integral [44839078148](https://github.com/erosCordova/bodyvision-ai/actions/runs/44839078148),
commit `b7f5867c2f5898cf6e1f30b1d0a69f95bc8ad3ee`, aprobó los tres jobs:
`native-checks`, `docker-smoke` y `windows-scripts`. Se verificaron **195** pruebas
backend, **234** frontend, **36** navegador público y **6** navegador privado
(**471** de aplicación), además de los scripts de instalación, compilación,
migraciones reversibles, auditorías de dependencias, arranque Docker, respaldo,
restauración aislada y conservación de historial tras recrear contenedores.
La prueba del navegador descargó el PDF desde Evolución, comprobó el hash y
los dos IDs de origen y encontró el evento confirmado de auditoría.

La Fase 7 pasa de **75 % a 80 %** como estimación técnica manual. El promedio
de diez fases pasa de **79,0 % a 79,5 %**, mostrado como **80 %**. Continúan
pendientes la firma/autenticidad externa y todos los criterios de uso real.

## Aislamiento de los recorridos privados

La prueba nueva del informe pasó en la ejecución `44838233965`. En esa misma
corrida, la carga de una captura de otra prueba concurrente agotó el
`statement_timeout` de 3 segundos esperando la cabecera de auditoría de la
organización compartida. `fullyParallel: false` no serializaba archivos.

Los recorridos privados se configuran ahora con `workers: 1`, sin reintentos
ni modificación de aserciones o del límite de PostgreSQL. Sus cuentas y la
cadena por organización son fixtures compartidos. Se conservan las pruebas
concurrentes explícitas de PostgreSQL del backend. Esta recepción secuencial
no demuestra rendimiento de producción con usuarios simultáneos: esa
medición sigue pendiente en los criterios operativos.
