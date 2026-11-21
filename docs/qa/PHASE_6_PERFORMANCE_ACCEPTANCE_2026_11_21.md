# BODYVISION AI — Fase 6: aceptación de rendimiento del visor 3D (21-11-2026)

## Entregable de esta iteración

Se integra una batería de aceptación **automatizada y reproducible** para el mismo atlas anatómico GLB que ya estaba fijado en las pruebas. No hay cambio de personaje, arquitectura, base de datos, servicio alojado ni resultados de usuarios.

La prueba `phase 6 acceptance profiles mobile and desktop layer residency without patient data`, incluida en `frontend/tests/e2e/body-viewer.spec.ts`, usa dos contextos independientes de **Chromium emulado**:

| Contexto | Vista CSS | DPR emulado | Modo inicial esperado | Máximo interno tolerado |
|---|---:|---:|---|---:|
| Móvil/táctil emulado | 390 × 844 | 3 | Fluida | 970 000 píxeles |
| Escritorio emulado | 1440 × 900 | 2 | Alta | 2 550 000 píxeles |

El margen en píxeles contempla redondeo del tamaño del canvas frente a los objetivos del renderizador (950 000 y 2 500 000, respectivamente). Estos **no son objetivos ni mediciones de FPS**.

Para cada contexto, la prueba:

1. Inicia el atlas real de referencia con recursos de prueba de versión fijada y espera la primera representación.
2. Obtiene el diagnóstico JSON desde la interfaz y comprueba el modo automático y tamaño de renderizado.
3. Activa el esqueleto, espera la disponibilidad del modelo, exige dos capas con geometría y comprueba el conteo de buffers CPU sin duplicación entre capas.
4. Oculta el esqueleto, comprueba que su memoria permanece retenida y que ya no figura visible.
5. Verifica que se mantiene **un único canvas** y no se realizan solicitudes de escritura a la API.
6. Adjunta `fase6-rendimiento-sintetico.json` a las pruebas de Playwright con el tamaño del lienzo, bytes de geometría, capas cargadas y tiempos **CPU de envío WebGL**. El artefacto de GitHub se entrega bajo `frontend/test-results`.

No se registran expedientes, pesos, estaturas personales, fotografías, coordenadas corporales, nombres de pacientes, credenciales, direcciones IP, identificadores de dispositivo ni contenido biométrico.

## Optimización integrada

- `ResizeObserver` no envía renderizados WebGL adicionales cuando ni el tamaño CSS ni la relación de píxeles cambian. Los cambios efectivos y la recuperación explícita del contexto gráfico sí vuelven a dibujar.
- El enfoque de cámara y el encuadre inicial evitan envíos duplicados cuando ya se produjo el evento de cambio o cuando la capa terminará de actualizar el fotograma.
- La simplificación de mallas LOD solo se solicita para capas visibles; se vuelve a comprobar la visibilidad antes de conservar geometrías simplificadas.
- El diagnóstico enumera por capa memoria de **buffers geométricos de CPU**, número de mallas, visibilidad y tiempo de carga; los valores por capa pueden compartir buffers y **no se suman** para determinar el total.

## Criterio técnico de aceptación

**Aceptación técnica confirmada el 21-11-2026.** La [CI integral 44963510164](https://github.com/erosCordova/bodyvision-ai/actions/runs/44963510164) aprobó el commit `20cd0f94687f879e89e2717db5394241aa8f4616` en `native-checks`, `docker-smoke` y `windows-scripts`: 278 pruebas backend, 257 frontend, 40 navegador público (incluida fase 6) y 8 privado; 583 pruebas de aplicación en total. La [aceptación de retención 44963510115](https://github.com/erosCordova/bodyvision-ai/actions/runs/44963510115) también aprobó.

Este conjunto satisface el criterio técnico de instrumentación y pruebas reproducibles. La Fase 6 pasa de **85 % a 90 %** según revisión manual del alcance; la media de las diez fases cambia de **87,0 % a 87,5 %**, y el tablero redondea a **88 %**. **No se considera cierre de fase al 100 %**: falta la validación en dispositivos físicos y con referencias morfológicas autorizadas.

## Límites importantes

Los tamaños de los buffers CPU **no representan VRAM, heap total ni consumo del sistema**. Los tiempos CPU no son mediciones de finalización GPU, FPS, temperatura, energía ni experiencia real. `isMobile` y DPR simulados no convierten Chromium en un teléfono físico. No se determina fidelidad clínica de pesos, estaturas o siluetas. Antes de cualquier uso real siguen pendientes pruebas de teléfonos con GPU y memoria distintas, referencia morfológica autorizada, revisión clínica/privacidad, consentimiento y aprobaciones humanas.
