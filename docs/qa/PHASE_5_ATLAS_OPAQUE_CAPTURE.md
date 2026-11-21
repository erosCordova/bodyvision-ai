# Fase 5 — fondo opaco en la captura sintética del atlas anatómico

## Hallazgo reproducido

La matriz MediaPipe de nueve escenarios sintéticos
([CI #44665930067](https://github.com/erosCordova/bodyvision-ai/actions/runs/44665930067))
registró una advertencia de iluminación en las capturas frontal y lateral
del atlas 3D, aun cuando el detector reconocía una pose. El visor renderiza
con alpha/transparencia y el control de captura computa luminosidad por
píxel RGB; los huecos transparentes **no** representan un fondo fotográfico
oscuro. Este detalle impedía usar la captura directa de la simulación como
control técnico sin advertencias.

## Modificación

`captureOpaqueAtlasPng` compone el WebGL ya renderizado sobre un mate
neutro `#c3d1d8` en un canvas auxiliar 2D con `alpha: false`, y produce
un PNG opaco de la misma resolución. Únicamente se activa al pulsar
«Analizar esta vista 3D con IA» dentro de simulación. No altera geometría,
modelo, tonos de piel, exposición de materiales, posición de cámara,
animación, morfología, malla ni el lienzo interactivo.

El canvas auxiliar se limpia después de generar el PNG, también cuando
falla la codificación. Los límites de 16 000 px por lado y 32 MP evitan
copias grandes sin control. Sigue siendo limpieza de recursos *best-effort*,
**no borrado seguro de memoria**. El resultado se somete después al mismo
`reviewLocalCapture` que aplica a fotografías ficticias cargadas por
el usuario. No se modifican ni reducen umbrales de calidad.

## Criterio de aceptación

- Pruebas unitarias confirman color del mate, secuencia de composición,
  conservación del canvas fuente, límites de superficie y liberación.
- Prueba E2E del botón original de simulación comprueba que la captura
  recibida por Análisis supera los **4/4** controles de captura y MediaPipe
  continúa detectando la pose del mismo atlas sintético.
- La matriz independiente de perturbaciones conserva los casos originales
  (incluidos los controles de captura con avisos) para documentar su
  susceptibilidad a condiciones reales.

No se admite uso clínico, fotos de personas reales ni validación de precisión.
No modifica despliegues ni la rama `main`.


## Validación final e integración · 19-11-2026 (Lima)

- PR [#20](https://github.com/erosCordova/bodyvision-ai/pull/20)
  revisada e integrada en la rama de desarrollo
  `feature/phase3-auth-security`, commit
  `3f8b09a87c966dc4132c96c7f4c742128a7a4cc0`.
- [CI #44667621228](https://github.com/erosCordova/bodyvision-ai/actions/runs/44667621228):
  `native-checks` y `docker-smoke` completadas correctamente;
  28 pruebas públicas de navegador y 5 privadas aprobadas.
- Tres pruebas unitarias nuevas de composición opaca completadas.
  La prueba E2E del simulador comprobó **4/4 controles de captura**
  y una pose realmente detectada por MediaPipe sobre el atlas.
- Evaluación técnica manual: **Fase 5 de 60 % a 65 %**;
  promedio de diez fases de igual ponderación **de 74 % a 75 %**.
  El avance representa funcionalidad técnica verificable, no calidad
  biométrica, autorización para imágenes reales ni preparación clínica.
- Se mantuvo sin cambios `main`, el personaje anatómico y la
  configuración de despliegues existentes.
