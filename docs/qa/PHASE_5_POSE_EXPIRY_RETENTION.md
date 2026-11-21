# Fase 5 — retención física de resúmenes sintéticos sin consentimiento vigente

Fecha: 20 de noviembre de 2026.

## Cambio técnico

La migración `0021_pose_retention` incorpora una función PostgreSQL de eliminación
por lotes de hasta 100 registros. Opera sobre `synthetic_pose_summaries` cuando
faltan las dos aceptaciones **vigentes** (`pose` y `storage`) de la última ronda
de consentimiento, y exclusivamente en organizaciones marcadas como sintéticas.
Los registros con ambos consentimientos válidos no se eliminan. Se utiliza
`FOR UPDATE SKIP LOCKED` para evitar esperas sobre filas bloqueadas.

La función no se publica como ruta HTTP y su ejecución se concede únicamente
al rol `bodyvision_app`, no a `PUBLIC` ni al rol de autenticación.
El servicio de retención existente y el trabajador autónomo optativo invocan
la nueva limpieza después de la retención de capturas cifradas, sin cambiar
la restricción de entorno local/test y activación `synthetic-only`.

Las claves de idempotencia de envíos borrados permanecen como lápidas, para que
un reintento no recree un resumen cuya conservación dejó de estar autorizada.

## Pruebas propuestas y límites de evidencia

La prueba `backend/tests/integration/test_pose_summary_retention.py` comprueba:
(1) no borrar un resumen vigente; (2) caducidad del consentimiento de pose;
(3) eliminación física de exactamente un resumen; (4) segunda pasada vacía;
(5) conservación de la clave de reintento y respuesta 410 tras renovar;
(6) rechazo de lotes cero o superiores a cien.

**La introducción de estos tests no prueba por sí sola su aprobación.**
Antes de cerrar esta entrega debe comprobarse el resultado integral de GitHub
Actions, migración adelante/atrás, seguridad, tests nativos y Docker.
No se incrementa el porcentaje del tablero hasta esa comprobación.

## Alcance y limitaciones

- Solo datos ficticios en local/test. No se modifica Neon, la demo pública,
  `main` ni se habilita la captura de personas reales.
- No se borran respaldos, WAL, registros de auditoría ni las claves de
  idempotencia; la purga ocurre con PostgreSQL disponible y trabajador activo.
- El historial médico no está validado clínicamente. Ni los resúmenes ni
  las simulaciones 3D constituyen diagnóstico o predicción médica.
- La función limita la cantidad por transacción, no promete una ventana
  universal de eliminación si el proceso está detenido.
