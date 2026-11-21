# Fase 6 — rendimiento del mismo atlas humano 3D

La optimización conserva **el modelo anatómico existente** y su escena, materiales,
peso, estatura y selección de estructuras. No introduce un personaje distinto ni
declara equivalencia con la referencia fotográfica final.

- `Fluida` inicia automáticamente en pantallas de hasta 760 px, interfaces
  táctiles gruesas o dispositivos que declaran hasta 4 GiB de RAM.
  Se puede escoger `Alta` manualmente.
- La resolución interna se limita por tamaño del lienzo: objetivo máximo
  de 950 000 píxeles en Fluida y 2 500 000 en Alta. No reduce los vértices de
  la anatomía y por tanto **no constituye LOD geométrico**.
- La malla poligonal ahora se construye solo cuando se activa. Los materiales
  y las geometrías de base se mantienen compartidos.
- Al activar giro, solo se procesa el evento de cambio de OrbitControls; se
  evita la segunda llamada a render de cada fotograma.
- El botón **Detalles** presenta resolución, número de mallas originales,
  mallas auxiliares, draw calls y triángulos del último fotograma completo.
  Incluye ambas pasadas en comparación dividida, tiempo de preparación CPU y
  recursos gráficos asignados. El tiempo CPU no mide finalización GPU ni FPS,
  y no permite deducir rendimiento móvil real. Véase
  `PHASE_6_LIVE_RENDER_DIAGNOSTICS.md`.
- Prueba de navegador con el modelo 3D auténtico: simula vista móvil, verifica
  resolución limitada, mallas superpuestas creadas a demanda y conservación del
  mismo lienzo. Las pruebas existentes comprueban que siguen funcionando
  deformación del cuerpo, estatura, capas y captura a MediaPipe.

**Pendiente:** recopilar tiempos y uso de GPU sobre teléfonos reales, LOD geométrico
licenciado y pruebas de una referencia fotográfica del personaje definitivo.
Los porcentajes del proyecto son estimaciones manuales, no un test de FPS.
