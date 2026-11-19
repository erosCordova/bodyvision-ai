# BODYVISION AI — F5: pose real en imágenes de prueba, ejecutada en el navegador

## Alcance de este incremento

El módulo **Captura corporal** puede recibir fotografías ficticias desde un
archivo o una cámara con permiso explícito. Antes de cualquier inferencia
revisa localmente formato, dimensiones, brillo, contraste y orientación.

**Analizar** recibe la imagen solamente mediante un objeto `File` en memoria
JavaScript del mismo tab. La foto nunca se pasa como `location.state`, no se
guarda en `localStorage`, `sessionStorage`, IndexedDB ni en PostgreSQL, y
la API BODYVISION no recibe bytes ni landmarks. Refrescar, descartar o salir
del análisis elimina ese objeto del componente (no equivale a borrado seguro
de toda la RAM del dispositivo).

El usuario pulsa **Detectar pose con IA**. Entonces se carga MediaPipe
`@mediapipe/tasks-vision` versión fija `0.10.32` en WebAssembly, con el
modelo `pose_landmarker_lite/float16/1` de Google y CPU, en modo `IMAGE`.
La ejecución de la inferencia se hace en el navegador. Si la salida incluye
los 33 landmarks normalizados, estos se superponen a la imagen original, con
visibilidad y comprobación básica de encuadre; si el detector no identifica
a una persona, no se muestran puntos inventados. Los resultados de un
detector externo **no** se convierten en altura, peso, grasa o medidas.

## Distribución local con integridad verificada

El navegador **ya no importa scripts ni modelos de un CDN**. Durante
`npm run dev` o `npm run build`, el script
`frontend/scripts/prepare_pose_assets.mjs` descarga las seis dependencias
de las fuentes originales y comprueba sus SHA-256 contra valores fijados
en el repositorio. El motor JavaScript `vision_bundle.mjs` se coloca en
`src/vendor/`, donde Vite lo compila como **chunk importado bajo demanda**.
Los ficheros WASM y el modelo van a `public/pose/`, servidos desde el mismo
dominio de la aplicación:

- `src/vendor/vision_bundle.mjs`: motor JS, versión exacta 0.10.32.
- `public/pose/wasm/vision_wasm_internal.{js,wasm}`: motor optimizado.
- `public/pose/wasm/vision_wasm_nosimd_internal.{js,wasm}`: alternativa sin SIMD.
- `public/pose/pose_landmarker_lite.task`: modelo Lite Float16, revisión 1.

Fuentes verificadas durante el empaquetado:

- JS/WASM: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/`
- Modelo: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`

Los recursos se sirven desde el **mismo dominio** de BODYVISION. Ni el
archivo fotográfico ni las coordenadas de su inferencia se transmiten a
Google, jsDelivr ni al backend. Un hash distinto o una descarga fallida
**interrumpe el proceso de compilación**. Los binarios verificados se
mantienen fuera de Git y se generan en cada instalación o compilación.
Una vez que el navegador tiene los recursos cargados, el procesamiento
en CPU/WASM puede realizarse sin conexión; no se garantiza una caché
offline persistente tras cerrar la pestaña.

El software de MediaPipe se distribuye públicamente bajo Apache-2.0,
aunque la revisión de obligaciones concretas de redistribución del modelo
y los avisos de terceros debe cerrarse antes de uso comercial con datos
privados. **No habilitamos fotografías médicas reales**: siguen faltando
autorización por expediente, consentimiento verificable, controles de
acceso y almacenamiento seguro. Esta mejora no sustituye las fases
de privacidad. El panel actual admite solo datos ficticios.

## Comportamiento y pruebas

- El visor anatómico mantiene el personaje base 3D elegido, sus capas,
  el peso, la estatura y la malla. En **Visión 3D → Simulación** se puede
  pulsar **Analizar esta vista 3D con IA**: el navegador captura el lienzo
  WebGL del personaje ficticio y lo envía solo en memoria a Análisis IA.
  No hace falta subir una fotografía ni añadir otro personaje.
- La detección real ha sido comprobada con una captura sintética de ese
  mismo atlas: el modelo devuelve una pose de 33 landmarks y el navegador
  superpone los puntos correspondientes sobre la imagen capturada.
- La pose se dibuja **sobre la fotografía o captura del atlas**, no se aplica
  automáticamente a la malla 3D (no existe retargeting ni un rig).
- Pruebas unitarias: 33 puntos, cero puntos cuando no hay persona, máscara
  de coordenadas inválidas y cobertura del encuadre.
- Pruebas de navegador: captura en memoria, detección real sobre una
  imagen sintética sin personas (sin falsos positivos), detección positiva
  sobre el cuerpo 3D del atlas, acción de captura directa Visión 3D → Análisis,
  ausencia de solicitudes del detector a terceros y ausencia de POST del archivo.
  El error por ausencia del chunk local se presenta sin inventar puntos.
- No hay promesas de precisión clínica, identidad ni calibración antropométrica.
- El SDK/modelo ya se empacan con SHA-256 y hay pruebas reales
  repetibles sobre imágenes sintéticas. Falta evaluar un **conjunto variado**
  de poses, cámaras, condiciones de luz y dispositivos, con métricas de
  detección y revisión de especialistas, antes de cerrar F5.

El avance de F5 se considera **parcial** hasta esa validación real.


## Revisión de calidad y pruebas de robustez sintética

La pantalla de Análisis IA ahora presenta puntos visibles por zonas: rostro,
hombros, codos, muñecas, caderas, rodillas y tobillos. El operador puede
variar el umbral de visibilidad en [0,30; 0,90] y activar o desactivar los
puntos y sus conexiones. Las posiciones de los puntos se dibujan en
coordenadas de imagen, sin distorsionar su radio entre retrato y paisaje.

La clasificación local de **revisión visual experimental** combina:

- presencia efectiva de 33 landmarks devueltos por el modelo;
- umbral de visibilidad y puntos dentro del encuadre normalizado;
- cobertura de los ocho puntos clave de hombros, caderas, rodillas y tobillos;
- advertencias previas de resolución, brillo, contraste y orientación.

Los estados son `Sin detección`, `Puntos insuficientes`,
`Requiere revisión` y `Visible para revisión visual`. No deben
interpretarse como probabilidad, precisión, sensibilidad clínica ni una
medición anatómica fiable.

Se agregó una matriz automatizada de condiciones reproducibles sobre
capturas **exclusivamente sintéticas** del atlas elegido: luz reducida,
resolución baja y recorte inferior del encuadre. El test conserva las
observaciones del detector real en
`test-results/pose-robustness-matrix.json` (incluido en los artefactos de
GitHub Actions) y exige advertencias cuando falta iluminación o resolución.
No establece umbrales de precisión clínica ni deduce que una persona real
sea apta para análisis a partir de estas pruebas. Una imagen sintética
sin personas verifica además el comportamiento sin detección.

La instancia del modelo CPU/WASM se reutiliza durante la navegación de
la misma pestaña para evitar descargas y compilaciones repetidas.
Solo se retiene el motor del modelo; las imágenes y los landmarks de
una captura se descartan al salir del análisis. El motor se cierra al
abandonar la página. El control visual y la calidad continúan siendo
experimentales y requieren evaluación sobre un conjunto de referencia
debidamente autorizado.
