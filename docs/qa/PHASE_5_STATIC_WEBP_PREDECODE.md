# Fase 5 — Fotos WebP estáticas antes del análisis local de pose

**Entorno:** análisis local con archivos ficticios, sin transmisión de imagen
al servidor. No cambiar el modelo anatómico ni la arquitectura de MediaPipe.

## Riesgo abordado

La validación de cabecera ya limitaba peso de archivo, dimensiones y
total de píxeles para PNG, JPEG y WebP. El contenedor WebP extendido
`VP8X` también admite **animación**: el indicador `0x02` activa
el contenido de fotogramas múltiples (`ANIM` / `ANMF`).

Una vista previa animada no es equivalente a la entrada estática de
`createImageBitmap` / inferencia de imagen: el usuario podría observar
un fotograma diferente al que MediaPipe evalúa. No se deben interpretar
esos fotogramas como una sola medición observada.

## Contrato implementado

- `readWebpFrameDimensions` rechaza `VP8X` con el bit `0x02`
  antes de decodificar o crear un lienzo.
- Sigue admitiendo WebP **estáticos** `VP8`, `VP8L` y `VP8X`;
  los indicadores de transparencia/ICC/EXIF por sí solos no causan rechazo.
- El mismo control se aplica a `reviewLocalCapture` y al análisis de pose,
  al compartir `validatePoseImageFile`.
- El mensaje en español explica que el archivo animado no se admite como
  fotografía estática. No se extraen fotogramas ni se guardan píxeles.

La referencia del flag es [RFC 9649, formato WebP](https://www.rfc-editor.org/rfc/rfc9649.html)
y la especificación pública del contenedor WebP de Google.

## Regresiones sintéticas

`frontend/tests/poseInputValidation.test.ts` prueba la cabecera
`VP8X` animada y una cabecera estática con alfa/metadatos.
`frontend/tests/capturePredecode.test.ts` verifica que el WebP animado
**no llama a `createImageBitmap`** al entrar por captura.

Se requiere CI integral del PR para aceptar el cambio.

## Alcance no validado

No se infiere la corrección de landmarks, la calidad clínica, el
rendimiento de GPU ni el soporte de dispositivos físicos. Las imágenes
APNG u otros formatos animados con nombres MIME incorrectos necesitan
su propio control; esta entrega aborda específicamente la bandera
oficial de animación WebP extendido. F5 90 %, global 93 % estimados
manuales hasta recepción externa.
