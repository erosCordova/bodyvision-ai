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

La ejecución CI integral del nuevo commit debe verificarse antes de dar por
cerrado el incremento o modificar la estimación del avance.
