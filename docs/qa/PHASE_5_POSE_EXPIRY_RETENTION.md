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

## Pruebas ejecutadas y límites de evidencia

La prueba `backend/tests/integration/test_pose_summary_retention.py` comprueba:
(1) no borrar un resumen vigente; (2) caducidad del consentimiento de pose;
(3) eliminación física de exactamente un resumen; (4) segunda pasada vacía;
(5) conservación de la clave de reintento y respuesta 410 tras renovar;
(6) rechazo de lotes cero o superiores a cien; (7) eliminación de resúmenes
huérfanos si también desaparecen los registros de consentimiento.

La ejecución específica
[44858285862](https://github.com/erosCordova/bodyvision-ai/actions/runs/44858285862)
aprobó **39 pruebas** en PostgreSQL de prueba, con roles separados, validación
de permisos, migración `0021` aplicada y reversión/restauración aprobada.
Se incluyen las pruebas del API privado de postura y el mantenimiento optativo.
Este gate es reproducible en `.github/workflows/pose-retention.yml`.

**Límite:** la CI integral no está aún aprobada con este cambio. Una suite
Docker anterior terminó con código 137, sin un diagnóstico concluyente del
motivo. La aceptación específica no cubre todos los módulos, navegadores,
equipos físicos o la calidad clínica. El tablero refleja una estimación manual
del alcance técnico, no una certificación del proyecto.

## Alcance y limitaciones

- Solo datos ficticios en local/test. No se modifica Neon, la demo pública,
  `main` ni se habilita la captura de personas reales.
- No se borran respaldos, WAL, registros de auditoría ni las claves de
  idempotencia; la purga ocurre con PostgreSQL disponible y trabajador activo.
- El historial médico no está validado clínicamente. Ni los resúmenes ni
  las simulaciones 3D constituyen diagnóstico o predicción médica.
- La función limita la cantidad por transacción, no promete una ventana
  universal de eliminación si el proceso está detenido.
