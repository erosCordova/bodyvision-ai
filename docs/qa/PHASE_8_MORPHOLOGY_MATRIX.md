# BODYVISION AI — Matriz morfológica sintética del mismo atlas 3D

Estado: **pruebas automatizadas añadidas; el resultado CI de este commit debe verificarse**.
Alcance: motor gráfico educativo, no morfología humana real ni precisión diagnóstica.

## Qué evalúa

La nueva batería `frontend/tests/morphologyMatrix.test.ts` evalúa
**960 combinaciones deterministas**: 4 pesos de referencia (40, 70, 110,
200 kg), 5 variaciones (−30, −15, 0, +15, +30 %), 3 estaturas (145, 175,
205 cm), 8 zonas de control y 2 direcciones (frontal y posterior).
Se usan las **mismas constantes regionales de la máscara GLSL**
(`softTissueProfile.ts`) y la misma fórmula ilustrativa de volumen
(`bodyVolume.ts`) que emplea el renderizador. No se entrenan modelos nuevos
ni se alteran los GLB, materiales ni los registros de PostgreSQL.

| Criterio de regresión | Control |
|---|---|
| Monotonía del volumen | La escala lateral/profundidad no disminuye cuando aumenta el % en una zona |
| Simetría lateral | Las máscaras dan la misma escala a izquierda y derecha |
| Regiones protegidas | Cabeza, pies y brazos periféricos mantienen sección original |
| Límites gráficos | La escala radial no sale del clamp GLSL 0,60–1,40 |
| Diferencias anterior/posterior | Se mantiene el sesgo ilustrativo de profundidad |
| Reversión | 70 kg, 0 % produce factor radial 1; no se genera otra malla |
| Estaturas | 145/175/205 cm afectan escala vertical; no inventan cambios radiales |
| Historia | Dos estaturas históricas mantienen límites verticales independientes |
| Saturación en los extremos | Se identifica que existen casos con clamp; **no** se presenta como una predicción corporal |

## Límites de esta evidencia

La matriz es una **regresión matemática del motor gráfico**, no una
comparación con tomografías, escáneres 3D, datos antropométricos ni
personas voluntarias. El perfil de pesos representa un criterio artístico.
No evalúa la piel real, composición de grasa, biomecánica, pertenencia
poblacional o cambios fisiológicos por aumento de masa. Las pruebas
WebGL de Chromium ya existentes validan que la malla cambia, pero
no sustituyen pruebas morfológicas con un corpus autorizado.

Pendiente para aceptación formal de Fase 8: benchmarking visual en un
conjunto autorizado de modelos de referencia, GPU y teléfonos físicos,
revisión de accesibilidad y privacidad, y aprobación de QA/producto.
No debe elevarse el porcentaje de la fase por esta matriz aislada.
