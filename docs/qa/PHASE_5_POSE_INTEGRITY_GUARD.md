# Fase 5 — integridad de detecciones y puntos superpuestos

## Riesgo atendido

El motor de pose local entrega hasta 33 puntos. Un resultado de exactamente
33 entradas sin coordenadas finitas podía activar la etiqueta de pose detectada
aunque no hubiera una posición utilizable. Además, una prueba sintética de
33 landmarks todos en la misma coordenada podía tener visibilidad 0,99 y
obtener el estado `reviewable` únicamente por número de puntos.

## Comportamiento implementado

1. `summarizePoseResult` comprueba que por lo menos una entrada tenga
   posición `x/y` finita; si ninguna cumple, devuelve `found: false`,
   ningún landmark y cero puntos visibles. Arrays incompletos de menos de
   33 entradas siguen rechazándose.
2. Una salida parcialmente válida se conserva, pero los puntos defectuosos
   quedan con visibilidad cero y el control habitual muestra
   `Puntos insuficientes` o una advertencia.
3. `assessPoseQuality` comprueba la extensión espacial normalizada de
   los ocho puntos clave (hombros, caderas, rodillas y tobillos) cuando
   todos son visibles. Si la diagonal del rectángulo que los contiene es
   menor que 0,06, el resultado pasa a `Puntos insuficientes` y explica
   que las posiciones aparecen casi superpuestas. No se crean ni
   corrigen coordenadas.
4. La imagen y sus puntos permanecen exclusivamente en el navegador.
   No se añaden capturas, almacenamiento, solicitudes a la API o
   modificaciones del atlas anatómico 3D.

## Pruebas sintéticas de regresión

- 33 posiciones NaN/Infinity ⇒ sin detección;
- 33 objetos sin coordenadas ⇒ sin detección;
- un punto finito y 32 inválidos ⇒ detección parcial, sin declarar cuerpo completo;
- 33 puntos visibles en idéntica coordenada ⇒ **insuficiente**, no `reviewable`;
- puntos sintéticos espacialmente distribuidos ⇒ comportamiento previo conservado.

Este gate detecta un caso de degeneración evidente, pero no verifica
anatomía humana, identidad, exactitud de landmarks ni validez clínica.
No sustituye el corpus de referencia, cámaras/dispositivos físicos,
consentimiento y revisión profesional exigidos antes de producción.

**No ajustar porcentajes sin revisar la CI completa y los criterios
documentados de salida de la fase.** Sin despliegue a Vercel o Render y
sin fusionar a `main`.
