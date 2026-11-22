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

**Aceptación técnica aprobada el 21-11-2026 (Lima).** La [CI integral 44964440107](https://github.com/erosCordova/bodyvision-ai/actions/runs/44964440107) concluyó con `success` para el commit `1a86016f1f3d70218869325b7223bf2ac155fe46`: **278 pruebas backend, 262 frontend, 43 de navegador público y 8 privadas (591 pruebas de aplicación)**, además de Windows, Docker, compilación, controles de dependencias y recuperación sintética. Las tres pruebas E2E nuevas de la fase 8 aprobaron: informe regional, esqueleto invariante frente al peso y estabilidad de recursos después de diez cambios de controles. La [aceptación independiente de retención 44964440089](https://github.com/erosCordova/bodyvision-ai/actions/runs/44964440089) también concluyó con `success`.

La Fase 8 se reevalúa manualmente de **85 % a 90 %**, por la instrumentación, visualización y pruebas técnicas reproducibles completadas. El promedio exacto de diez fases sube de **87,5 % a 88,0 %**; el tablero sigue mostrando **88 %** debido al redondeo del valor anterior. **La fase no está cerrada al 100 %** porque sigue pendiente la validación física y morfológica.

Quedan pendientes requisitos que las pruebas sintéticas no pueden sustituir: fidelidad morfológica comprobada contra referencias autorizadas, evaluación independiente de seguridad y privacidad, funcionamiento en GPU y teléfonos físicos con distintas capacidades, validación clínica cuando proceda y aceptación formal de producto. La versión es educativa e ilustrativa.

## Archivos de implementación y evidencia

- `frontend/src/features/viewer/regionalMorphAudit.ts`
- `frontend/src/features/viewer/AnatomyAtlas.tsx`
- `frontend/src/features/viewer/anatomy-studio.css`
- `frontend/tests/regionalMorphAudit.test.ts`
- `frontend/tests/e2e/body-viewer.spec.ts`

Evidencia de aceptación: CI 44964440107, commit de implementación `1a86016f1f3d70218869325b7223bf2ac155fe46` y aceptación de retención 44964440089. Las capturas de estrés, cuando se soliciten, se conservan únicamente como artefactos de CI.
