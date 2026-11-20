# Fase 5 — matriz reproducible de evaluación de pose

**Estado:** evaluación técnica local con datos sintéticos, sin validación clínica.
Implementación: `frontend/src/features/capture/poseInference.ts`, `poseQuality.ts`.
Pruebas: `frontend/tests/poseValidationMatrix.test.ts` y `poseInference.test.ts`.

## Cobertura automática

| Escenario ficticio | Verificación esperada |
| --- | --- |
| 33 landmarks visibles | Revisión visual experimental, nunca precisión clínica |
| Tobillos ocultos | Advertencia de articulaciones clave y revisión |
| Imagen recortada, 5 puntos útiles | Puntos insuficientes, sin inferir articulaciones |
| Umbral 0,5 vs 0,8 | La visibilidad cambia sin alterar los resultados del modelo |
| Iluminación insuficiente | Revisión obligatoria aunque los landmarks sean visibles |
| Sin detección o array incompleto | No construir una pose ficticia |
| Coordenadas NaN/Infinity | No dibujar coordenadas inválidas ni declararlas visibles |

## Higiene de memoria

La detección mantiene la fotografía dentro del navegador. Al finalizar o fallar el procesamiento se cierran los `ImageBitmap` temporales y se limpia/redimensiona el lienzo auxiliar. El detector reutilizable no debe conservar la foto de entrada. Esta liberación es **best-effort**: no se afirma destrucción segura de todas las copias de memoria, GPU, navegador o sistema operativo.

## Gates antes de uso clínico o piloto con personas

1. Preparar un corpus de evaluación lícito y autorizado, estratificado por iluminación, fondo, recortes, oclusión, postura, cámara y dispositivo; no añadir fotografías personales al repositorio ni a CI.
2. Definir una referencia humana revisada, métricas de falsos positivos, localización de puntos y sensibilidad a condiciones de captura, con umbrales aprobados.
3. Ensayar en teléfonos reales (latencia, memoria, temperatura, WebAssembly, fallos de cámara); registrar pruebas reproducibles.
4. Revisar licencias de MediaPipe/activos, privacidad, retención, consentimiento y tratamiento de errores; no prometer medición diagnóstica.
5. Mantener habilitación restringida a demo sintética hasta cerrar seguridad/privacidad y los gates de validación.

**No se ha ejecutado una validación clínica ni se ha certificado precisión por estas pruebas.**

## Control de tamaño JPEG antes de decodificar

La validación local examina los marcadores JPEG hasta hallar un segmento SOF que
contenga ancho y alto. Solo analiza un prefijo acotado de 128 KiB; si no aparece
SOF dentro de ese límite o la estructura es inválida, el archivo se rechaza,
antes de llamar a `createImageBitmap` o inicializar MediaPipe. Se incluyen
segmentos APP/EXIF que preceden al SOF y variantes habituales de JPEG con SOF.
Los límites de dimensiones siguen siendo 16 000 px por lado y 32 MP.

Esta decisión puede rechazar algunos JPEG legítimos con metadatos muy extensos;
se prefiere el rechazo explícito frente a una decodificación no acotada en la
demostración sintética. WebP conserva los controles de firma y tamaño del archivo,
y la validación de dimensiones después de la decodificación. Ningún control
sustituye la revisión de privacidad y seguridad antes de aceptar fotos reales.
