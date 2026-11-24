# Fase 6 — controles de teclado, adaptación automática y recuperación

Esta mejora **no sustituye el cuerpo humano seleccionado** ni modifica geometrías,
texturas, proporciones ni la simulación 3D.

- **Auto** adapta `Alta` o `Fluida` a ancho de ventana, apuntador táctil y
  memoria declarada. Se vuelve a evaluar al rotar un móvil o redimensionar.
  Cuando el usuario elige `Alta` o `Fluida`, la preferencia manual prevalece
  hasta que vuelva a pulsar `Auto`.
- El lienzo 3D es enfocable con Tab y admite flechas para girar, `+`/`-`
  para zoom, `Inicio` para centrar y `Escape` para quitar una selección.
  Los gestos táctiles de OrbitControls y los botones de cámara siguen disponibles.
- Ante un evento `webglcontextlost`, la interfaz detiene el giro e indica
  la interrupción. Al recibir `webglcontextrestored`, Three.js reconstruye
  sus recursos de WebGL y BODYVISION redimensiona el visor y habilita
  nuevamente el giro. El botón `Recargar visor` sigue disponible como
  alternativa si la restauración automática no funciona.
- Se evitan llamadas repetidas a `renderer.setSize` cuando el lienzo
  ya tiene las dimensiones apropiadas.
- E2E prueba cambio móvil→escritorio, bloqueo manual y retorno a modo Auto;
  prueba rotación y zoom por teclado, y usa eventos **simulados** de pérdida y
  recuperación del contexto gráfico. Esos eventos NO constituyen una prueba
  de pérdida real del GPU. Esta prueba real aún está pendiente en dispositivos.
