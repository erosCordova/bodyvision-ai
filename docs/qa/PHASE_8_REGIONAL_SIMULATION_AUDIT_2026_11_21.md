# BODYVISION AI — Fase 8: auditoría regional de simulación y estabilidad (21-11-2026)

## Alcance de este entregable

Este entregable continúa sobre el **mismo atlas 3D seleccionado**, sin duplicar personajes, modificar el esquema de base de datos ni cambiar el despliegue. La deformación en GPU ya estaba implementada para la piel y, con menor intensidad, los músculos; las estructuras rígidas mantienen su geometría original. Se incorpora un inspector de cinco regiones que utiliza las mismas máscaras y parámetros del shader para explicar, de forma local, cómo cambia visualmente la silueta.

- Zonas: abdomen, caderas, pecho, muslos y pantorrillas.
- Métricas: variación lateral y frontal de escala de la malla en puntos representativos, **comparadas con la referencia ilustrativa actual**.
- La interfaz muestra valores positivos y negativos, barras proporcionales y avisos de saturación al alcanzar el límite del shader (0,60 a 1,40).
- La vista del atlas original presenta cambios cero cuando se solicita la comparación; el regreso al escenario restaura la inspección.
- Estas cifras **no** son perímetros corporales, porcentajes de grasa, masa muscular, resultados clínicos ni predicciones de cómo cambiaría un ser humano con ese peso.

## Comprobaciones automatizadas

1. **Unitarias:** zonas y orden coinciden con el shader; variación nula = cero; cambios positivos y negativos; coherencia de la escala frontal con el sesgo de profundidad; saturación; valores inválidos y límites de barras.
2. **Chromium con modelo real versionado:** los controles actualizan el inspector al aumentar y disminuir el volumen; retorno a cero; saturación; previsualización original.
3. **Invariancia de esqueleto:** variar el peso de referencia sin piel visible no altera la imagen del esqueleto; la estatura sigue alterando su escala vertical. No se usa una segunda malla.
4. **Estabilidad de recursos:** diez combinaciones de variación de peso y estatura en alta calidad comprueban que no crezcan los recursos geométricos CPU/WebGL ni las texturas, que exista un único canvas y que no haya solicitudes de escritura a API. Se adjunta un JSON técnico de evidencias sin identificadores de pacientes ni datos del expediente.

La prueba de estrés de navegador evalúa los límites **técnicos** de las operaciones uniformes; no mide VRAM real, finalización de GPU, FPS, temperatura o rendimiento en dispositivos físicos. Los porcentajes en la interfaz son factores de escala artificiales y nunca medidas de personas.

## Aceptación y pendientes

El cierre técnico de este lote **depende de que la CI del último commit alcance `success`** en Windows, Docker y las pruebas nativas, y de que apruebe el navegador público y privado. No se incrementará el progreso de fase por el solo hecho de agregar código.

Quedan pendientes requisitos que las pruebas sintéticas no pueden sustituir: fidelidad morfológica comprobada contra referencias autorizadas, evaluación independiente de seguridad y privacidad, funcionamiento en GPU y teléfonos físicos con distintas capacidades, validación clínica cuando proceda y aceptación formal de producto. La versión es educativa e ilustrativa.

## Archivos de implementación y evidencia

- `frontend/src/features/viewer/regionalMorphAudit.ts`
- `frontend/src/features/viewer/AnatomyAtlas.tsx`
- `frontend/src/features/viewer/anatomy-studio.css`
- `frontend/tests/regionalMorphAudit.test.ts`
- `frontend/tests/e2e/body-viewer.spec.ts`

Al completar la ejecución integral, registrar la URL de CI y el SHA validado antes de revisar el tablero.
