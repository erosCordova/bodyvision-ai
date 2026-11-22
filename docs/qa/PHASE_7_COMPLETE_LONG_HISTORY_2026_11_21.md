# BODYVISION AI — CSV completo de historiales extensos

## Comportamiento

La exportación privada longitudinal deja de rechazar historiales por
superar 500 observaciones. Una única consulta PostgreSQL mantiene su
instantánea mediante un cursor real de servidor y se consume en lotes
de 500; las filas no se acumulan en una lista. El orden es estable por
fecha e identificador. Se conservan todas las observaciones vigentes
de la métrica, expediente y periodo autorizados.

El límite ahora es **8 MiB de bytes UTF-8 del CSV completo**, incluidos
encabezado y saltos de línea, sin un límite arbitrario de 500 filas.
Si se supera, la API devuelve `HISTORY_TOO_LARGE` con la instrucción de
reducir el periodo: no entrega un archivo parcial ni registra una
exportación exitosa. Un error tardío de fuente o auditoría tampoco
produce una respuesta de descarga. El cursor se cierra antes de
registrar el evento `report.export.csv` en la misma transacción.

La respuesta conserva ID, fecha de la instantánea, recuento real de filas,
nombre y SHA-256 del archivo. El navegador permite el nuevo tamaño,
rechaza archivos decodificados que excedan el límite y verifica encabezado,
UTF-8, cantidad de observaciones y hash antes de ofrecer la descarga.
La interfaz comunica el límite por tamaño. El proceso tiene un presupuesto
de archivo; no afirma memoria total constante ni exportación ilimitada.

## Evidencia y regresiones

- PostgreSQL real: **1.207 filas**, incluidas fechas coincidentes, con
  exactamente los IDs y orden esperados. Se comprueba un cursor psycopg
  de servidor con `yield_per=500`. Una escritura concurrente posterior
  a abrir la consulta no aparece en el CSV en curso y sí en el siguiente
  (**1.208** filas). El evento CSV queda confirmado antes de responder.
- Exceso de tamaño: rechazo sin bytes/hash de archivo y sin evento de
  exportación; la siguiente solicitud válida funciona tras el rollback.
- Servicio: generador de una sola pasada con 1.201 observaciones, aceptación
  del presupuesto exacto, rechazo con un byte menos disponible y lectura
  detenida al agotar el presupuesto.
- Navegador unitario: CSV de **5.001** filas que supera el antiguo límite
  base64; rechazo de recuentos parciales y de 8 MiB más un byte.
- Chromium privado: fixture con permiso explícito de lectura y **2.007**
  observaciones; comprueba el archivo realmente descargado, todos sus IDs
  en orden, recuento, SHA-256, nombre y evento de auditoría por HTTP real.

La comprobación local suplementaria aprobó ocho pruebas de API y 300
backend en PostgreSQL 16 descartable; solo se excluyó la aserción de versión
PostgreSQL 15. La CI integral sobre PostgreSQL 15 está pendiente de cierre.

## Alcance

Solo expedientes ficticios y entornos local/test. No acredita firma externa,
escritura persistente en el disco final del usuario, interpretación clínica,
capacidad productiva concurrente ni historias ilimitadas. Un periodo que
exceda 8 MiB se debe reducir; no se divide automáticamente en descargas
que puedan corresponder a instantáneas distintas. No modifica Neon ni
despliegues públicos. La evaluación de avance se realizará al aceptar la CI.
