# BODYVISION AI — Fase 6: cadencia observada del giro 3D (23-11-2026)

## Problema y alcance

El diagnóstico del atlas ya registraba el tiempo de CPU empleado para
enviar instrucciones WebGL, pero esa métrica **no es FPS ni mide tiempos GPU**.
La aceptación con hardware físico sigue pendiente.

Se añade una medición opcional de la **cadencia de callbacks
`requestAnimationFrame`** cuando el usuario habilita el giro automático
de exactamente el mismo atlas 3D. No se altera el personaje, su geometría,
las capas, el shader ni el modo de calidad.

## Instrumentación

- En cada callback del giro visible, `AnatomyScene` comprueba que
  `OrbitControls.update()` realmente produjo un envío de WebGL.
  Si no se renderizó, no añade una muestra.
- Se miden diferencias temporales entre callbacks que enviaron cuadros;
  se conservan **como máximo 120 intervalos** positivos y finitos.
- Las pausas con pestaña oculta, rotación detenida o contexto WebGL
  interrumpido reinician el punto de referencia. Una separación de más
  de 2000 ms no se trata como cadencia continua.
- Se calculan mediana y P95 de esos intervalos, usando nearest-rank.
  Si todavía no hay dos callbacks válidos, ambos valores son nulos.
- Los datos aparecen en **Detalles → Diagnóstico de visualización** y
  en la descarga local JSON ya existente, junto a los tiempos CPU.
  Al desactivar/reiniciar Giro se limpia la ventana de muestras,
  evitando mezclar distintas sesiones de rotación.
- Los contadores no contienen imagen, perfil, peso, estatura,
  biometría ni identificador del dispositivo; no se envían a la API.

## Pruebas automáticas

`frontend/tests/renderFramePacing.test.ts` cubre vacíos, valores
inválidos, 120 muestras, percentiles, retrocesos temporales y pausas.
`frontend/tests/e2e/body-viewer.spec.ts` comprueba en Chromium
con el GLB anatómico de versión fijada la rotación opt-in, el
diagnóstico y su descarga, el cierre de muestras al detener Giro,
el mismo canvas y cero escrituras HTTP. La matriz Docker y Windows
debe completarse antes de fusionar el PR.

## Lo que esta mejora no demuestra

**Intervalo rAF ≠ FPS presentados en pantalla.** El navegador puede
programar callbacks sin garantizar que cada cuadro finalice en la GPU
o sea mostrado por el panel. La cifra tampoco representa memoria VRAM,
temperatura, consumo energético, fluidez subjetiva o exactitud clínica.
En dispositivos que limitan rAF pueden existir sesgos. Para cerrar
Fase 6 siguen siendo necesarias mediciones físicas reproducibles en
varios teléfonos y GPU y verificación morfológica con referencias
autorizadas y especialistas.

**F6 permanece en 90 % y el global técnico estimado en 93 %.**
Se mantienen `main`, la producción, Neon y el atlas únicos sin cambios.
