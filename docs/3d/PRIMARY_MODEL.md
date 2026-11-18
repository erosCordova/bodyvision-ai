# Modelo humano 3D principal de BODYVISION AI

## Decisión de interfaz (18-11-2026)

El único personaje base elegido para la experiencia visible es el **modelo masculino de cuerpo completo** que ya se muestra en el atlas anatómico. Debe conservarse el mismo personaje al abrir **Visión 3D**, al manipular estatura o volumen, al alternar malla poligonal y en la vista previa del panel principal.

## Fuente única y punto de integración

- Modelo de piel: `web/public/models/skin.glb` del repositorio de referencia `SeemaBansal1/3d-human-body-anatomy`, fijado al commit `28912432581accd7a1c62129d55f0e9758221d48` en `frontend/src/features/viewer/atlasSource.ts`.
- Motor: `frontend/src/features/viewer/AnatomyScene.ts` (`createAnatomyScene`), compartido entre `AnatomyAtlas.tsx` y `DashboardBodyPreview.tsx`.
- Visión 3D: ruta `/body-3d` y simulación integrada `/body-3d?panel=simulacion`.
- Capas anatómicas externas (músculos, esqueleto, arterias, venas y nervios) se mantienen con sus condiciones de atribución; no se sustituyen por otra persona al activar controles.
- El prototipo MPFB `adult-demo.glb.gz` y el visor `BodyViewer.tsx` son históricos, ya no forman parte de la navegación ni de la vista previa del dashboard.

## Controles ilustrativos

- **Estatura**: escala vertical del conjunto anatómico (145–205 cm, referencia visual 175 cm). No altera la identidad ni cambia el activo GLB.
- **Peso/volumen**: desviación visual acotada (−30 % a +30 %) mediante deformación de vértices en la GPU sobre la piel; la cifra en kg es una etiqueta hipotética sin equivalencia clínica.
- **Malla 3D**: superposición de triángulos sobre la misma geometría y con la misma deformación, no un segundo modelo.
- **Comparación**: escenario local temporal con peso de referencia, porcentaje y estatura. No modifica historias clínicas ni mediciones.

## Alcance y limitaciones

La apariencia es educativa y artística. No hay calibración antropométrica, predicción realista de distribución de grasa, diagnóstico, rig clínico ni reconstrucción de pacientes. La carga actual utiliza un activo remoto con revisión fijada; requiere red y disponibilidad del origen. Antes de uso en producción médica deben validarse el licenciamiento, la seguridad del suministro y la fidelidad anatómica.
