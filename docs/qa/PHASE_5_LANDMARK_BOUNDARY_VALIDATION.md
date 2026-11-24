# Fase 5 — Detección sintética y puntos dentro de la imagen

## Hallazgo (23-11-2026)

El parser local de MediaPipe recibía 33 landmarks y consideraba una pose
detectada si **cualquier** par `x/y` era finito, aunque los 33 pares
quedaran completamente fuera de la imagen. No era un resultado visible ni
revisable. También se suponía que el contenedor de puntos era un arreglo,
por lo que un resultado de estructura inesperada podía lanzar en `.some`
antes de devolver una respuesta controlada.

## Corrección

- `summarizePoseResult` comprueba que `landmarks` y la primera pose
  tengan estructura de arreglo real de 33 elementos.
- Requiere al menos una pareja de coordenadas **real, finita y dentro del
  rango de imagen normalizado 0..1** para comunicar `found=true`.
- Si todos los puntos están fuera, ausentes o no son finitos, devuelve
  `found=false`, `landmarks=[]`, cero visibles y
  `fullBodyReview=false`, sin fabricar articulaciones.
- Una pose parcial con un solo punto dentro del encuadre se preserva para
  revisión insuficiente; no se declara cuerpo completo ni calidad clínica.
- El código no altera la versión, opciones, archivo binario ni parámetros
  del modelo MediaPipe; no genera métricas antropométricas.

## Regresiones de aceptación

`frontend/tests/poseInference.test.ts` reproduce 33 coordenadas
finitas fuera del encuadre, contenedores no-array/malformados, entrada
nula y una sola articulación visible con otras 32 fuera.
`frontend/tests/poseQuality.test.ts` confirma que una salida totalmente
fuera de imagen se clasifica como `not-detected` y nunca como
`reviewable`.

CI requerida: tests de frontend, navegador, Windows y Docker. Verificar
el último commit del PR antes de declarar el bloque integrado.

## No demuestra

No se usa un corpus de personas autorizado, ni hardware físico. Tener
un punto dentro del cuadro **no prueba** que se haya identificado
correctamente a una persona; solo conserva un resultado incompleto para
revisión prudente. La exactitud, privacidad y aceptación por especialistas
siguen pendientes. El progreso técnico manual permanece en F5 90 % y
global 93 %.
