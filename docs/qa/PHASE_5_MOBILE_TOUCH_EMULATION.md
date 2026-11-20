# Fase 5 — emulación táctil móvil del flujo anatómico y MediaPipe

## Alcance del ensayo

Nueva prueba de navegador Chromium configurada con **390 × 844 px**,
`isMobile: true`, `hasTouch: true` y `deviceScaleFactor: 2`.
Las transiciones de pantalla simuladas usan `844 × 390` y
regresan a retrato. El trabajo se ejecuta sobre el mismo atlas anatómico
sintético licenciado, cargado desde recursos fijados por hash.

La prueba cubre en conjunto:

- Resolución, pixel ratio y modo de renderizado «Fluida» automático
  sin exceder el presupuesto GPU de **950 000 píxeles** (margen técnico
  por redondeo hasta 970 000).
- Uso real de controles táctiles de vista frontal, malla poligonal y
  variación simulada de peso en **un solo WebGL canvas**.
- Giro de orientación emulado sin pérdida del visor ni del modo fluido.
- Tránsito **Simulación 3D → captura opaca → análisis IA local**.
- Advertencia de resolución para la imagen de captura que nace de un
  lienzo pequeño, en vez de declararla de alta calidad sin evidencia.
- Ejecución real de MediaPipe y diagnóstico técnico optativo tras
  consentimiento ficticio. Se acepta el resultado observado
  «pose detectada» o «sin detección», sin falsificar inferencias.
- Ausencia de errores JS y de escrituras a la API durante el recorrido.

## Limitación importante: capturas en teléfonos pequeños

El visor aplica correctamente un límite de rasterización GPU para
reducir trabajo durante la exploración 3D. Por ello, el PNG generado a
partir de esa superficie en un dispositivo pequeño **puede no alcanzar
el requisito de 720 px en su lado corto**. La revisión de calidad debe
mantener la advertencia de «Resolución», sin escalar por interpolación
para aparentar detalle no capturado. Es una limitación documentada de
la captura sintética, no una desactivación de los filtros de calidad.

El ensayo corresponde a **emulación de viewport/entrada táctil en
Chromium de CI**. No es prueba física de cámara, CPU ARM, GPU de móvil,
RAM, energía, temperatura, Safari iOS o Android real. Esas coberturas
se mantienen pendientes y no aumentan el porcentaje de fase.
No despliegues ni cambios al personaje base o la rama `main`.
