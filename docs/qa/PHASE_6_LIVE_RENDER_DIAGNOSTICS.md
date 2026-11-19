# Fase 6 — diagnóstico local del renderizado

La comparación dividida dibuja el mismo cuerpo en dos pasadas. El reinicio
automático de `WebGLRenderer.info` en cada pasada descartaba las operaciones
de la referencia: el diagnóstico anterior mostraba solo las del escenario.
Se desactiva `info.autoReset` y se reinician los contadores una vez por
fotograma completo, conservando las dos pasadas y la misma geometría.

En **Visión 3D → Rendimiento → Detalles** se muestran:

- Resolución interna, mallas originales y superposiciones.
- Operaciones gráficas y triángulos enviados de todas las pasadas.
- Número de pasadas y tiempo CPU de preparación del último fotograma.
- Geometrías y texturas asignadas por Three.js, y disponibilidad del contexto.

El tiempo se mide con `performance.now()` alrededor de la preparación y envío
de comandos. No espera finalización GPU, no mide FPS ni latencia de entrada
y no certifica fluidez en teléfonos físicos. Los triángulos son envíos a la
GPU, no recuento de triángulos únicos del modelo. Los recursos se cuentan;
no se afirma medir sus bytes de memoria.

El panel consulta estadísticas cada segundo mientras está abierto y la
pestaña visible. Consultarlas o descargarlas no dibuja nuevos fotogramas.
Cerrar el panel o desmontar el visor elimina el temporizador. La descarga
JSON incluye únicamente revisión del atlas, fecha UTC e indicadores de
renderizado; no contiene imágenes, medidas corporales, expedientes ni
identificadores del dispositivo. No envía información a la API.

La prueba de navegador usa las capas GLB fijadas y comprueba que:

1. Un fotograma dividido cuenta el doble de operaciones y triángulos cuando
   referencia y escenario no tienen variación, sin duplicar las geometrías.
2. Las actualizaciones del panel no animan una escena en reposo.
3. La descarga mantiene un contrato técnico sin datos corporales.
4. El diagnóstico vuelve a una pasada al cerrar la comparación, con un único
   lienzo durante todo el recorrido.

## Validación local del 19 de noviembre de 2026

Lint, TypeScript, 40 pruebas Vitest y compilación Vite aprobados. La ejecución
local de Playwright se bloquea al iniciar Chromium porque el entorno deniega
la creación del socket de proceso (`Operation not permitted`), antes de
abrir una página. No se considera una validación de navegador aprobada.
La ejecución integral se realiza en GitHub Actions y se documenta en la PR.

El avance manual permanece en **59 %**. Continúan pendientes teléfonos físicos,
LOD geométrico y evaluación morfológica frente a la referencia elegida.
