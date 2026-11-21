# Fase 5 — historial privado de resúmenes de pose ficticios

## Flujo incorporado

Desde Captura corporal se transfiere la imagen local al módulo de análisis,
donde el detector permite asociar un resumen al expediente
ficticio seleccionado. Se conservan detección/no detección, recuentos de puntos
visibles y principales, umbral, estado heurístico de calidad, comprobación de
captura, revisión del modelo, revisión del esquema de resumen, responsable y
fecha de guardado del servidor. El historial se consulta por páginas de veinte,
con búsqueda de expediente, actualización y borrado confirmado. También se
consulta desde la pestaña Resultados de pose del propio expediente.

La inferencia continúa ejecutándose en el navegador. El servidor **no verifica
ni ejecuta de nuevo** MediaPipe ni comprueba que una imagen corresponda al
resultado. Las filas se etiquetan `DERIVADO`, `synthetic=true` y
`origin=client_reported_browser`. No son observaciones, diagnósticos ni prueba de
precisión. No se guardan fotos, coordenadas, nombres de archivo, tiempos de
inferencia, URL o texto libre; tampoco se conserva una huella de la imagen.
La traza identifica modelo/esquema y resumen declarado, no una reconstrucción
científica reproducible de una imagen de origen.

## Contrato y autorización

Migración `0020_pose_summaries`, exclusiva de la rama de desarrollo. API privada:

- `GET /api/v1/profiles/{id}/pose-summaries?limit=20&offset=0`.
- `POST` a la misma ruta, con `Idempotency-Key` UUID y confirmación ficticia.
- `DELETE /api/v1/profiles/{id}/pose-summaries/{summary_id}`.

La ruta solo se monta con identidad local/test. La organización y responsable
provienen de la sesión, nunca del cuerpo. Se comprueban acceso al expediente y
aceptaciones efectivas de **pose y conservación**, política `bv-synthetic-v1`,
último ciclo y caducidad. Las filas de aceptación se bloquean contra revocación
concurrente. RLS vuelve a comprobar organización, permisos y aceptaciones.
Solo administradores/especialistas con permiso de escritura pueden guardar o
borrar; los miembros autorizados solo consultan. No se habilitan datos reales.

El contrato rechaza propiedades extra —incluidas fotos y landmarks—, modelos
ajenos, recuentos fuera de rango, booleanos usados como números, umbrales no
finitos y estados contradictorios básicos. No recalcula la heurística completa
sin coordenadas. La etiqueta `reviewable` sigue siendo una declaración del
navegador que satisface mínimos de consistencia, no una certificación del servidor.
El cliente proyecta una lista de campos antes de enviar, aunque un objeto
interno contenga propiedades adicionales.

## Integridad, reintentos y borrado

Cada guardado tiene ID nuevo y una huella SHA-256 de la entrada normalizada,
expediente y revisión del esquema. No se concede UPDATE al rol de aplicación.
Las tablas de mediciones y escenarios no se modifican. La creación y su evento
`pose.create` se confirman en una transacción; un fallo de auditoría revierte
fila y clave de envío. La consulta/repetición y el borrado también se auditan.
La huella no es una firma ni acredita autenticidad de la inferencia.

Repetir una clave con la misma entrada devuelve el mismo resultado; cambiar la
entrada produce conflicto. Tras borrar la fila se conserva un registro mínimo
de envío y huella, sin el contenido del resumen, para devolver 410 y evitar
que una respuesta perdida seguida de reintento recree el resultado borrado.

Revocar pose o conservación purga los resúmenes en la misma transacción.
Renovar un propósito con un ciclo nuevo también purga los anteriores, de modo
que aceptar de nuevo no restaura resultados antiguos. La caducidad bloquea
lectura/guardado, pero **no inicia por sí misma un borrado físico periódico**;
la eliminación física ocurre al revocar, renovar o borrar explícitamente.
Un escritor autorizado puede borrar un ID aunque su aceptación haya caducado.
Auditoría, claves de envío, backups, WAL y snapshots tienen retención separada;
este incremento no acredita su eliminación irreversible ni una política clínica.

Los callbacks tardíos no cambian el expediente ni la sesión visibles. Una
solicitud de escritura ya iniciada puede confirmarse aunque se cambie de
pantalla: no se presenta el cambio de vista como cancelación del servidor.
Las claves se reutilizan en un reintento de la misma detección y no se guardan
en almacenamiento del navegador. La pestaña **Resultados de pose** del expediente consulta el historial
sin cargar una fotografía ni repetir la inferencia.

## Verificación aprobada

- Contrato mínimo y consistencia con resultados negativos válidos.
- PostgreSQL: permisos, aislamiento, dos finalidades, paginación/total, reintentos,
  borrado sin resurrección, revocación/renovación y fallo atómico de auditoría.
- Interfaz: confirmación ficticia, permisos de miembro y proyección sin medios.
- Navegador: ejecución real de MediaPipe sobre un patrón ficticio, guardado del
  resumen mínimo, consulta después de navegar y borrado sin crear mediciones.

La ejecución integral [44847175532](https://github.com/erosCordova/bodyvision-ai/actions/runs/44847175532),
commit `169f5dcb1d5305b547beea2fda82b42b991df4bf`, aprobó Windows, Docker y pruebas
nativas: 226 backend, 242 frontend, 36 navegador público y 8 privado
(**512 pruebas de aplicación**, sin contar duplicados de Docker). El recorrido
privado ejecutó MediaPipe sobre el patrón sin persona, guardó el resultado
negativo, lo consultó desde el expediente y lo borró sin generar mediciones.
No es una prueba de exactitud sobre personas.

La Fase 5 pasa de 65 % a 75 % y el promedio manual exacto de 80,5 % a 81,5 %,
mostrado como **82 %**. Continúan pendientes corpus
independiente autorizado, dispositivos físicos, evaluación de precisión y toda
recepción clínica/operativa. `main` y la base alojada no se migran en esta entrega.
