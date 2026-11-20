# Fase 5 — cancelación efectiva y recaptura móvil sin resultados obsoletos

## Problema

La interfaz de BODYVISION ya descartaba los **resultados** tardíos cuando
se cancelaba una prueba, cambiaba la fotografía o se desmontaba la vista.
Sin embargo, una solicitud antigua podía seguir validando, decodificando
e incluso invocando MediaPipe durante la espera de inicialización del
motor, aunque el resultado no se mostrase.

## Cambio funcional

`createPoseInferenceSession`, `detectPoseOnDevice` y
`diagnosePoseOnDevice` aceptan ahora una condición opcional `isCurrent`
que conserva compatibilidad con las llamadas anteriores. Se comprueba
antes del trabajo y **después de cada operación asíncrona**:

- Antes y después de validar el archivo y sus cabeceras.
- Tras decodificar/preparar el canvas de la imagen.
- Después de esperar la disponibilidad del motor MediaPipe.
- Inmediatamente antes de `landmarker.detect()`.

Si el usuario cambió o canceló la operación, no se ejecuta la
inferencia obsoleta y se libera la superficie temporal mediante
`finally`/captura de excepción. También se pasa este guard al
benchmark de cinco inferencias y al diagnóstico por etapas.
No se cachean fotos ni resultados; el único recurso reutilizado
continúa siendo el propio modelo local.

**Limitación:** la invocación síncrona `detect()` ya iniciada en
MediaPipe no es interrumpible dentro de JavaScript. Las nuevas guardas
evitan la siguiente inferencia obsoleta si la cancelación ocurrió
mientras se esperaba un límite asíncrono; no prometen cancelación
instantánea ni mejoras de FPS o RAM medidas.

## Pruebas de regresión

- Cinco pruebas unitarias con límites de validación/decodificación
  controlados verifican que no se vuelva a decodificar después de
  cancelar, que se libere el canvas y que no se arranque el motor
  para la imagen obsoleta.
- Las pruebas de interfaz verifican que `isCurrent()` pase a falso
  al cambiar una foto, desmontar la vista, cancelar benchmark o
  cancelar diagnóstico.
- E2E móvil emulado: dos capturas reales independientes de **la
  misma anatomía sintética**, doble inferencia en una captura,
  cambio horizontal/vertical, retorno al visor sin duplicados y
  análisis MediaPipe posterior. Todas las pruebas usan imágenes
  anatómicas sintéticas; no validan exactitud clínica.

Sin cambios en personaje 3D, shaders, base de datos, rama
`main` ni despliegues. El porcentaje global sigue sujeto a
validación con teléfonos físicos reales.
