# Verificación del atlas anatómico · 18 noviembre 2026

La interfaz vigente es el atlas inmersivo en /body-3d, incorporado en main después del primer prototipo MPFB. Se conserva ese diseño y sus seis capas. El prototipo corporal CC0 ya no es la ruta pública y su documentación histórica no describe el atlas actual.

Correcciones: nombre applyPreset (no es un hook React); estados loading/ready/error por capa; reintento de una capa; error WebGL y recarga completa sin volver a abrir la página; movimiento reducido actualizado en vivo; catálogo y modelos fijados a la misma revisión. El estado data-loaded solo es verdadero cuando una capa visible terminó de cargar.

## Activos y dependencias

Fuente: https://github.com/SeemaBansal1/3d-human-body-anatomy/tree/28912432581accd7a1c62129d55f0e9758221d48

La geometría se descarga desde esa revisión de GitHub al activar capas, no desde main mutable. El decodificador Draco JavaScript/WASM proviene de la dependencia Three.js 0.187.0 y Vite lo publica en el mismo dominio; ya no se necesita descargar el decodificador desde gstatic. Las capas siguen dependiendo de conectividad con GitHub.

Solo se cargan skin, muscles, skeleton, arteries, veins y nerves. No se añade organs. Se conserva la atribución visible a Z-Anatomy, BodyParts3D y la adaptación web de SeemaBansal1. La evidencia de licencia upstream, con sus atribuciones y excepciones, está en docs/3d/ATLAS_UPSTREAM_LICENSE.txt. La presencia de atribuciones no se presenta como una revisión legal completa de cada estructura ni como validación clínica del texto.

## Pruebas

Se sustituyen las pruebas de la ruta antigua por la ruta pública actual. Las pruebas de navegador cargan las mallas Draco reales skin.glb y skeleton.glb de la revisión fijada, verificando sus hashes de blob Git antes de utilizarlas. No se sustituye el cuerpo por geometría de prueba. El resto del catálogo se limita para que las comprobaciones de búsqueda sean deterministas.

Se comprueban carga real de WebGL, vistas, zoom, cambio de capa/opacidad, búsqueda de fémur, acceso a recorridos, reset, movimiento reducido, errores y reintento de descarga, navegador sin WebGL, ausencia de escrituras y desbordamiento en móvil. Las capturas y trazas se guardan en el artefacto bodyvision-browser-evidence de CI.

La revisión visual en el navegador remoto encontró WebGL deshabilitado en ese entorno (GL_VENDOR/GL_RENDERER Disabled). Eso impide usar ese navegador como evidencia de renderizado del cuerpo; no se atribuye a un fallo universal de BODYVISION. La comprobación gráfica se realiza en Chromium de CI con SwiftShader explícito. Los resultados y enlaces concretos se informan tras finalizar la ejecución.
