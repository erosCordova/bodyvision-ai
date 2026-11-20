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
demostración sintética. Ningún control sustituye la revisión de privacidad y
seguridad antes de aceptar fotos reales.

## WebP: comprobación de dimensiones antes de decodificar

WebP se verifica también por su primer bloque RIFF, sin descomprimir píxeles:
`VP8 ` (con pérdida), `VP8L` (sin pérdida) y `VP8X` (extendido, incluso
contenedores animados) tienen estructuras distintas. Se lee un máximo de
30 bytes del encabezado; se comprueban la firma RIFF/WEBP, el tipo y longitud
del bloque, las marcas específicas del formato y ancho/alto. Los mismos límites
de 16 000 píxeles por lado y 32 MP se aplican antes de `createImageBitmap`.
Un encabezado desconocido o truncado se rechaza explícitamente.

El control es una inspección de cabecera, **no** una verificación integral del
archivo, un detector de carga maliciosa ni garantía contra errores del
decodificador. Tras `createImageBitmap` se comprueban también las dimensiones
reales, que pueden diferir de los metadatos. Solo se admiten datos ficticios
en las demostraciones.

## Revisión de avance y métrica automática de regresión · 19-11-2026

El evaluador `frontend/src/features/capture/poseGateBenchmark.ts` recibe
escenarios **sintéticos** con la decisión de revisión visual esperada y calcula:
la proporción de decisiones coincidentes y el recuento de casos que el sistema
clasificó como `reviewable` pese a que el escenario esperaba una advertencia.
La batería `frontend/tests/poseGateBenchmark.test.ts` comprueba seis
condiciones representativas y detecta un ejemplo de promoción indebida.
**Estas cifras evalúan reglas de interfaz sobre datos inventados, no la precisión
real de MediaPipe ni sensibilidad/especificidad clínica.**

La revisión de la arquitectura v3 incrementa la **Fase 5 de 50 % a 60 %** por:
(1) inferencia local real y 33 landmarks ya existentes;
(2) control de resultados asíncronos y limpieza temporal;
(3) verificación previa de cabeceras de PNG, JPEG y WebP;
(4) matriz de visibilidad/oclusión con resultados esperados y métricas de regresión.
El promedio aritmético de las diez fases de igual ponderación pasa de
**71 % a 72 %**. El incremento es una estimación técnica manual y **no** acredita
validación en dispositivos reales, seguridad clínica o preparación para producción.

**Para aumentar de nuevo la Fase 5:** se requiere una evaluación reproducible
con un corpus autorizado y etiquetas independientes, condiciones de iluminación,
posturas y dispositivos definidos; establecer umbrales de rendimiento/errores,
revisión humana, persistencia/auditoría autorizada y aprobación de privacidad.
