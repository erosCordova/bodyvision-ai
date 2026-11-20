# Fases 4–5 — límite previo a la decodificación en captura

## Problema y corrección

El análisis de pose ya filtraba por dimensiones en la cabecera de PNG, JPEG
y WebP, con máximo de 16 000 píxeles por lado, 32 MP totales y 10 MiB de
archivo. Sin embargo, **Captura corporal → Control de calidad local** hacía
una comprobación de firma de 12 bytes e intentaba decodificar antes de imponer
un límite de píxeles. Una fotografía muy comprimida podía reservar una
superficie enorme durante el preflight incluso sin llegar a MediaPipe.

Ahora `reviewLocalCapture` reutiliza `validatePoseImageFile` antes
de llamar a `createImageBitmap`. Además, valida las dimensiones reales
retornadas por el decodificador (una cabecera podría discrepar), cierra el
`ImageBitmap` y limpia el canvas auxiliar y la copia temporal de píxeles
cuando se ha podido obtener. Es limpieza **best-effort**, no borrado seguro
garantizado por el navegador/GPU.

## Límites y comprobaciones

- Tipos `image/png`, `image/jpeg` y `image/webp`; contenido contrastado
  con cabecera y dimensiones parseadas antes de descomprimir.
- Archivo mayor que 0 y hasta 10 MiB; dimensión máxima por lado 16 000 px;
  total máximo 32 MP.
- JPEG: SOF en prefijo de hasta 128 KiB; WebP: VP8/VP8L/VP8X; PNG: IHDR.
- Rechazo temprano de archivos truncados y discrepancias entre cabecera y
  dimensiones decodificadas.
- Pruebas unitarias y un test de navegador con imagen ficticia cuyo encabezado
  declara 64 MP: se rechaza en Captura, no hay enlace a Análisis ni envío API.

## Límites pendientes

Se trata de una protección de recursos para demostraciones ficticias.
No es un antivirus, un decodificador validado formalmente, un escáner
de archivos maliciosos o una garantía de eliminación en memoria.
No habilita imágenes de pacientes ni altera el atlas 3D.
El cierre de F4 y F5 sigue condicionado a privacidad, validación en
dispositivos físicos, controles jurídicos y revisión de seguridad de producción.
No hay despliegue ni cambios en `main`.
