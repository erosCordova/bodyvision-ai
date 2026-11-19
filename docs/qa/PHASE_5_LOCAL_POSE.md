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

## Dependencias y seguridad

- Módulo JS de `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/vision_bundle.mjs`
- WASM de `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm`
- Modelo `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`

Las solicitudes externas son para **descargar software y pesos de modelo**, no
para enviar fotografías. Sin conectividad, CORS disponible y compatibilidad
WASM, la interfaz muestra un error recuperable en vez de un resultado ficticio.

**Limitación de privacidad:** el SDK JavaScript se importa desde un CDN remoto
sin verificación local de integridad criptográfica. Se limita a imágenes
sintéticas de prueba; **no introducir fotografías médicas ni corporales
privadas reales**, pues no se considera una cadena de suministro de confianza
para datos sensibles. Antes de uso real: empaquetar los binarios y pesos
localmente con hashes verificados, política CSP estricta, revisión de seguridad,
controles de autorización/consentimiento verificables y retención.

La autorización actual es una confirmación declarativa de uso ficticio,
**no** consentimiento clínico validado. El modo privado no se activa.

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
