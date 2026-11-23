# Fase 7 — Verificación externa de un archivo descargado (solo datos ficticios)

## Qué añade

`scripts/verify_downloaded_report.py` compara una **copia ya guardada en el sistema
de archivos** con el ID, formato, número de filas (CSV) y SHA-256 de la **respuesta
autenticada** de exportación de BODYVISION. No necesita red, base de datos ni
bibliotecas adicionales. El resultado no contiene expedientes, valores, rutas,
nombres ni el hash.

La herramienta no modifica la exportación ni sus eventos de auditoría. Es un
control adicional de integridad transferible a una recepción asistida fuera
de Chromium. Está cubierta por las pruebas Windows/Linux de `scripts/tests`.

## Recepción técnica reproducible

En un entorno local/test **con expedientes ficticios**, y únicamente después
de descargar el archivo mediante la interfaz privada, conservar por un canal
separado los valores de la respuesta HTTP autorizada:

- PDF: `report_id`, `sha256` y `filename`.
- CSV: `export_id`, `sha256`, `row_count` y `filename`.

El archivo ya descargado debe existir con ese nombre en un directorio local
autorizado. Ejemplos con identificadores y hashes **inventados**:

```bash
python scripts/verify_downloaded_report.py \
  --file /ruta/autorizada/bodyvision-11111111-2222-4333-8444-555555555555.pdf \
  --export-id 11111111-2222-4333-8444-555555555555 \
  --sha256 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --format pdf

python scripts/verify_downloaded_report.py \
  --file /ruta/autorizada/bodyvision-historial-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.csv \
  --export-id aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee \
  --sha256 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --format csv --rows 2
```

Los hashes de ejemplo no corresponden a archivos reales, por lo que esas
órdenes están destinadas a ilustrar los argumentos, **no a declarar un pase**.
En una recepción real se sustituyen por los datos devueltos por la API y las
rutas existentes. En Windows pueden utilizarse rutas locales entre comillas.

- Salida válida: `{"event":"downloaded_report_verified","format":"pdf"}` o
  `{"event":"downloaded_report_verified","format":"csv","rows":2}`; código 0.
- Rechazo: `{"event":"downloaded_report_rejected"}`; código 2, sin ruta ni
  datos del archivo. Rechaza nombre/ID equivocados, hash alterado,
  estructura PDF/CSV incompatible, recuento incorrecto, fechas UTC inválidas,
  valores numéricos no finitos, métricas/unidades mezcladas y filas fuera de
  orden, enlaces simbólicos, enlaces duros, archivos demasiado grandes y
  modificaciones durante lectura.
- La comprobación del SHA-256 es **posterior a la descarga**; si el archivo se
  modifica después de comprobarlo, debe repetirse la verificación.

## Comprobación desde la propia interfaz (sin terminal)

Después de pulsar **Descargar informe PDF** o **Descargar historial observado
(CSV)** en un expediente ficticio autorizado, la página ofrece **Verificar PDF
guardado** o **Verificar CSV guardado**. Esa segunda acción abre el selector
local de archivos: el usuario elige la copia que realmente aparece en su disco.
La verificación comprueba que el nombre es el esperado, que la copia tiene un
tamaño permitido y que su SHA-256 coincide exactamente con el hash de la
respuesta autenticada que el navegador ya había validado al exportar.

La comparación se hace únicamente en memoria del navegador con
`File.arrayBuffer()` y `crypto.subtle.digest()`. **No envía el archivo de
vuelta al servidor**, ni guarda el hash o contenido en almacenamiento local.
La referencia se descarta al cambiar de expediente, métrica o periodo; para
comprobar después de recargar la página hay que generar una nueva exportación.
La comprobación certifica solo igualdad de bytes **en el momento de
seleccionarlos**, no durabilidad posterior, autoría independiente, custodia,
firma digital, validez médica ni aceptación productiva.

El helper `frontend/src/features/analytics/savedReportVerification.ts` tiene
tests de regresión en `frontend/tests/savedReportVerification.test.ts`, y las
pantallas implicadas son `MeasurementComparison.tsx` y
`LongitudinalSummary.tsx`.

## Protección contra archivos especiales (22-11-2026)

Al seleccionar una copia local, se abre con `O_NONBLOCK` cuando el sistema
operativo lo admite, además de las restricciones existentes contra enlaces,
archivos no regulares y tamaños fuera de límite. Así una tubería FIFO con un
nombre de PDF aparentemente válido se rechaza por su tipo de descriptor sin
bloquear la lectura esperando un escritor. Se añade una regresión específica
para POSIX; en Windows se omite únicamente esa prueba dependiente del sistema.
No se amplía el alcance a datos reales ni se considera firma digital.

## Límites explícitos

**No es firma digital ni prueba de autenticidad del servidor.** El hash de la
respuesta debe conservarse de forma confiable, separado del archivo; un
atacante capaz de sustituir ambos podría construir otra pareja coherente.
La verificación del nombre y de los bytes no certifica que el archivo haya
sido descargado por la persona titular, que permanezca durablemente en disco
o que un auditor independiente haya aprobado sus datos.

No acredita custodia externa, persistencia en el equipo final del usuario,
evaluación médica, uso de datos reales, almacenamiento en Neon, ni criterio
de producción. Se preserva el **95 % estimado manualmente de fase 7 y el 92 %
global mostrado** sin atribuir nuevos cierres formales.

## Evidencia automatizada

```bash
python -m unittest discover -s scripts/tests -v
```

Este comando ya está en los jobs `windows-scripts` y `native-checks` de
`.github/workflows/ci.yml`. Los tests crean únicamente PDFs/CSV ficticios
temporales: verifican casos correctos y rechazos por cambios de bytes,
recuento, esquema, identificador, nombre, fechas, valores, orden, enlaces, truncado y formato.
