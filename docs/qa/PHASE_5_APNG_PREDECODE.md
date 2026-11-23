# Fase 5 — APNG no es una fotografía estática para pose local

**Fecha:** 23 de noviembre de 2026. Solo pruebas sintéticas locales.

## Problema

La comprobación original de PNG examinaba la firma y 24 bytes de IHDR
para limitar dimensiones sin decodificar. Un PNG con extensión de
animación APNG (chunk `acTL`) comparte esa firma y puede representar
fotogramas distintos del que recibe MediaPipe en modo IMAGE, por lo que
la vista previa animada podría diferir de la imagen inferida.

## Contrato añadido

La función `validatePoseImageFile`, compartida por captura y pose,
recorre las cabeceras de chunks PNG **sin leer sus payloads**:

- Comienza tras la firma; exige IHDR inicial de longitud 13.
- Avanza saltando por la longitud declarada, validando que no exceda el
  tamaño del archivo; cada lectura parcial obtiene solamente 8 bytes.
- Rechaza `acTL`, `fcTL` y `fdAT` antes del primer `IDAT` con
  mensaje local en español sobre imagen animada.
- Se detiene al encontrar el primer `IDAT`, que delimita la cabecera
  anterior a los datos de imagen. Admite metadatos PNG estáticos
  `tEXt` y similares previos al `IDAT`.
- Rechaza ausencia de `IDAT`, truncamiento y más de 512 chunks previos
  a datos, para impedir recorridos no acotados.

Las pruebas unitarias heredadas que fabrican solamente 24 bytes de IHDR
sirven para ejercitar el **prechequeo de dimensiones**: no son archivos
PNG decodificables. Los navegadores rechazan esas estructuras al crear
el bitmap. No se anuncian como ejemplos válidos de imágenes completas.

## Pruebas

- `frontend/tests/poseInputValidation.test.ts`: APNG con `acTL` y
  `fcTL`, control `fcTL` anómalo, PNG estático con texto, longitud
  manipulada, chunk list muy larga y archivo truncado sin IDAT.
- `frontend/tests/capturePredecode.test.ts`: captura APNG se rechaza
  **antes** de `createImageBitmap`.
- `frontend/tests/e2e/capture-quality.spec.ts`: Chromium carga un
  contenedor APNG sintético; la UI rechaza el formato sin efectuar
  escrituras HTTP ni transferirlo a análisis.

Este trabajo usa imágenes fabricadas, no conserva fotografías ni
modifica modelos, atlas o infraestructura.

## Límites

Solo se examina la estructura de **PNG conforme al orden estándar**
(APNG anuncia animación antes del primer `IDAT`). No equivale a
una validación criptográfica, reproducción de todos los formatos o
certificación morfológica. Dispositivos físicos, corpus autorizado,
consentimiento, privacidad, exactitud de pose y aceptación clínica
siguen pendientes. F5 90 % y avance global 93 % son estimaciones
técnicas manuales.
