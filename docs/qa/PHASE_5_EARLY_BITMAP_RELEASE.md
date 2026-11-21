# Fase 5 — liberar el bitmap grande antes de inicializar MediaPipe

## Hallazgo

En `detectPoseOnDevice`, la ejecución anterior decodificaba la imagen
completa y esperaba la carga de MediaPipe/WASM **antes** de escalarla al
lienzo de inferencia de hasta 1024 píxeles. En una primera ejecución,
la espera de descarga/inicialización podía mantener abierto un bitmap
grande mientras se reservaba memoria para el modelo.

## Cambio de ciclo de vida

Ahora `preparePoseFrame` dibuja en el mismo lienzo de hasta
1024 px por lado que se utilizaba previamente y ejecuta
`ImageBitmap.close()` antes de devolverlo. Solo después se solicita
`loadPoseLandmarker()`. La extracción de landmarks, los 33 puntos,
los umbrales, la calidad de la captura y la resolución de inferencia
**no cambian**. No hay reducción adicional en dispositivos de gama baja.

`frame.release()` limpia y redimensiona a cero el canvas auxiliar en
`finally`, incluso si falla la descarga del modelo o la inferencia.
Si el decodificador devuelve dimensiones no admitidas, si el canvas no
tiene un contexto 2D o si falla el dibujo, se libera el bitmap y las
superficies auxiliares antes de propagar el error.

**Importante:** este cambio reduce el solapamiento de recursos grandes,
pero no demuestra una reducción de memoria RAM real del navegador:
el decodificador, WASM, GPU, recolector de basura y sistema operativo
pueden mantener copias internas no controlables. No se afirma
eliminación segura de la imagen, aceleración medida ni rendimiento
de teléfonos físicos.

## Verificación

Cinco pruebas unitarias sintéticas comprueban:
- cierre del bitmap original antes de devolver el frame;
- escalado de 8000 × 4000 a 1024 × 512 sin cambiar el límite;
- conservación de imágenes menores de 1024 px;
- rechazo de dimensiones no permitidas sin nuevo canvas;
- limpieza y cierre en errores de dibujo o falta de contexto 2D.

La batería de navegador existente mantiene inferencia real
MediaPipe sobre el atlas anatómico sintético y los gates de calidad.
No se habilitan datos de pacientes. Sin cambios en la capa 3D,
simulación, `main`, Neon, Vercel ni Render.

## Pendientes

Se necesitan ensayos reproducibles en dispositivos físicos reales
(móviles con diferentes recursos), tiempos de carga fría/caliente,
memoria, temperatura, fallos del proceso WebAssembly, corpus autorizado
y revisión de privacidad/seguridad antes de incrementar la fase 5
por rendimiento. No sustituir estas mediciones por resultados sintéticos.
