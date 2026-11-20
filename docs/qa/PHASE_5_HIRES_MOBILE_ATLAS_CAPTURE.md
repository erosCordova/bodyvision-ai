# Fase 5 — captura anatómica 3D de alta resolución en móviles

## Hallazgo

La calidad «Fluida» del visor usa deliberadamente un presupuesto de
hasta 950 000 píxeles GPU para la exploración interactiva. La función
de análisis heredaba la resolución del WebGL canvas y, en pantallas
pequeñas, su lado corto podía quedar por debajo de los **720 píxeles**
que exige el control de calidad de captura.

## Solución

Durante la acción explícita «Analizar esta vista 3D con IA», el mismo
renderizador Three.js vuelve a dibujar **la misma anatomía, pose,
cámara, material y simulación de peso/estatura** a una resolución
temporal con lado corto objetivo de **800 píxeles**. No hay
interpolación de una captura pequeña: se rasterizan de nuevo los
triángulos y shaders del atlas. Los límites son 2,4 millones de
píxeles y 2 500 px por lado, con razón de renderizado máxima 4.
Las relaciones de aspecto imposibles se rechazan expresamente; nunca
se presentan píxeles ampliados como mayor detalle.

Después se compone el fondo mate opaco solo en un canvas 2D auxiliar
y se codifica PNG; incluso si falla la exportación, un `finally`
restaura el tamaño y calidad de WebGL usando el `resize()` del visor.
No hay segundo personaje ni cambio persistente de consumo GPU. El
modelo no se descarga de nuevo. El análisis individual mantiene la
validación previa por formato, dimensiones, brillo, contraste y pose.

## Validación

- Planificador unitario de tamaño: móvil 390×574, escritorio, relación
  extrema, datos inválidos, límite de píxeles y conservación de modo
  de calidad suficiente.
- La prueba móvil táctil recorre la simulación, captura y MediaPipe
  real. Exige **4/4 controles** en el atlas sintético iluminado,
  verifica dimensiones del PNG realmente capturado y confirma que al
  volver al visor el presupuesto «Fluida» queda nuevamente limitado.
- Las pruebas no miden FPS, memoria RAM, GPU física ni precisión
  biométrica. Sigue pendiente comprobar teléfonos Android/iOS reales,
  operaciones sin conexión, rendimiento, autorizaciones y revisión
  clínica antes de usar fotografías de personas.

No modificar `main` ni desplegar solo para este control.
