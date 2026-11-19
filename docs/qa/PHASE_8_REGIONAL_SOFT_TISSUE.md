# Fase 8 — Deformación regional ilustrativa sobre un único cuerpo 3D

Revisión: 19-11-2026. Alcance de demostración, no clínico.

## Qué se implementó

El simulador de peso conserva la **misma escena, el mismo personaje anatómico, las capas, la cámara y la malla poligonal**. El control de variación de peso sigue entre −30 y +30 %, sin atribuirle capacidad predictiva sobre grasa, musculatura o composición corporal individual.

La deformación en el shader GPU se distribuye suavemente y mediante máscaras independientes entre **abdomen, caderas, pecho, muslos y pantorrillas**. Se utilizan posiciones relativas a la altura y distancia a la línea media del atlas. La respuesta lateral y la respuesta en profundidad están diferenciadas, con un sesgo frontal suave para que el abdomen no se expanda idénticamente hacia delante y hacia atrás. Se mantienen sin modificación regional por peso la cabeza/rostro, manos y pies.

Los límites de cada zona se comparten entre una función JavaScript verificable y una función GLSL **generada a partir de los mismos parámetros**, alojadas en `frontend/src/features/viewer/softTissueProfile.ts`.

En la representación se corrige la normal de superficie con una **aproximación de primer orden** para que las luces respondan al cambio de sección. No se recalculan normales a partir de anatomía real y esto no constituye simulación biomecánica.

El estado de referencia (0 %) evita cálculos de deformación en el shader y reproduce el modelo inicial. Las estructuras duras (huesos, arterias, venas y nervios) no reciben el shader de volumen. La capa muscular aplica una fracción atenuada de la deformación y la piel aplica la intensidad visual completa. La malla poligonal visible sigue la deformación de la misma superficie.

## Validación

Última ejecución funcional antes de documentar: [GitHub Actions 44552567358](https://github.com/erosCordova/bodyvision-ai/actions/runs/44552567358), **130 pruebas aprobadas**: 50 backend, 54 frontend y 26 navegador, además del arranque Docker.

Pruebas nuevas:
- `softTissueProfile.test.ts`: cinco regiones, límites suaves, pesos laterales simétricos, frente/espalda distintos, exclusión de cabeza y extremidades, factores finitos y reversibilidad en el origen.
- `body-viewer.spec.ts`: en el atlas WebGL real, +30 % y −30 % producen contornos distintos; al volver al 0 %, el lienzo recupera su imagen de referencia; la superposición poligonal funciona y no aparecen errores de shader.

## Límites que siguen abiertos

- Es una **ilustración gráfica**, no un ajuste a mediciones corporales, composición de tejido, características demográficas, IMC, masa grasa o resultados clínicos.
- La geometría de referencia proviene de un atlas anatómico educativo y puede diferir del cuerpo real de una persona. No debe asociarse a un expediente personal como reconstrucción del paciente.
- Los cambios no incorporan simulación de tejidos con físicas ni comprobación de colisiones y pueden generar intersecciones en algunas capas al aumentar peso.
- La escala vertical por estatura es ilustrativa; no predice proporciones óseas ni crecimiento real.
- Quedan pendientes ensayos de calidad anatómica y rendimiento en teléfonos físicos, verificación de límites de autoría de activos y flujos de consentimiento/control de acceso para cualquier futuro uso real.
