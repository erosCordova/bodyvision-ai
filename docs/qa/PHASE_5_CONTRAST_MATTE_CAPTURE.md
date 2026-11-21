# Fase 5 — fondo mate de contraste para captura sintética

## Problema reproducido

Tras el renderizado temporal a 800 × 1177 píxeles en Chromium móvil
emulado, la captura del atlas anatómico había superado resolución,
iluminación y orientación, pero la separación de color entre la piel
marrón clara y el anterior fondo azul-grisáceo claro `#c3d1d8`
dejó el control de **contraste** bajo el umbral existente (3/4).

## Cambio aplicado

Para la **copia PNG sintética hacia IA solamente**, se utiliza un
fondo uniforme azul-gris oscuro `#344e68`, detrás de los píxeles con
alfa del **mismo** renderizado del atlas 3D. El lienzo WebGL en pantalla
mantiene su transparencia, iluminación, materiales, shaders, cámara,
resolución fluida y personaje original. No se modifica ni se aplica
filtro al cuerpo, no se cambia el modelo de IA y no se alteran los
umbrales de resolución (720 px), iluminación, contraste (22) u
orientación.

Se evita tanto un degradado en el fondo creado para inflar
artificialmente la desviación estándar como un ajuste automático del
contraste de los píxeles del cuerpo. Es un fondo fijo, de estudio,
diseñado para separar visualmente la silueta clara de su entorno.

## Pruebas y límites

- Una prueba unitaria de `atlasCapture.test.ts` usa una silueta
  ficticia simplificada sobre el fondo uniforme y ejecuta el
  **mismo** `assessCapturePixels` de producción. Exige contraste e
  iluminación válidos, pero no finge que esa imagen diminuta supera
  la regla independiente de resolución.
- La prueba E2E móvil táctil en Chromium exige los cuatro criterios de
  la **captura real del atlas ficticio** (sin mocks) y sigue analizando
  con MediaPipe. Las pruebas E2E de captura frontal y la matriz
  sintética verifican que no se rompa la detección existente.
- El cambio no constituye precisión diagnóstica ni mejora validada
  sobre fotografías humanas. Las condiciones de sujetos reales,
  móviles físicos, GPU, memoria y evaluación clínica continúan
  pendientes. No habilitar fotografías de pacientes.

No modificar `main`, base de datos ni desplegar exclusivamente
para este ajuste visual.
