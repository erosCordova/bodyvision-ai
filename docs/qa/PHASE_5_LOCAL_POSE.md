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
de las fuentes originales, comprueba sus SHA-256 contra valores fijados
en el repositorio y coloca las versiones aprobadas bajo `public/pose/`:

- `vision_bundle.mjs`: motor JS, versión exacta 0.10.32.
- `wasm/vision_wasm_internal.{js,wasm}`: motor optimizado.
- `wasm/vision_wasm_nosimd_internal.{js,wasm}`: alternativa sin SIMD.
- `pose_landmarker_lite.task`: modelo Lite Float16, revisión 1.

Fuentes verificadas durante el empaquetado:

- JS/WASM: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/`
- Modelo: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`

Los ficheros se sirven desde el **mismo dominio** de BODYVISION. Ni el
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

- El visor anatómico mantiene el personaje base 3D elegido y su simulación
  de peso, estatura y malla. La pose se dibuja **sobre la fotografía**, no se
  aplica automáticamente a la malla 3D (no existe retargeting ni un rig).
- Pruebas unitarias: 33 puntos, cero puntos cuando no hay persona, máscara
  de coordenadas inválidas y cobertura del encuadre.
- Prueba de navegador: captura y transferencia en memoria, carga bajo
  demanda, error si el CDN no responde, descarte de imagen y ausencia de
  POST de la fotografía.
- No hay promesas de precisión clínica, identidad ni calibración antropométrica.
- Falta probar inferencia real sobre un conjunto de imágenes sintéticas
  representativas y registrar versiones/hashes de modelo antes de marcar
  F5 como completada.

El avance de F5 se considera **parcial** hasta esa validación real.
