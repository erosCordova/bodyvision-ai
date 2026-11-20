# Fase 7 — resumen estadístico longitudinal de observaciones ficticias

## Incremento

En **Expedientes → Evolución**, junto al gráfico existente, se muestra un resumen
de la métrica elegida en el periodo activo: número de observaciones vigentes,
mediana sin ponderación temporal, mínimo y máximo, diferencia entre primera y
última fecha distinta y variación porcentual cuando la base no es cero.

La función filtra por expediente, métrica, procedencia `OBSERVADO`, versión
vigente, ID único, valor finito y fecha interpretable. No mezcla simulaciones
3D, no lee otros expedientes, no interpola ausencias y no hace solicitudes API
adicionales. Se listan brechas superiores a 48 h, mediciones atípicas
confirmadas y mezcla de métodos manuales/dispositivos. Una o dos observaciones
no demuestran una tendencia y se avisa de la muestra pequeña.

## Validación

Pruebas unitarias propuestas: orden cronológico de respuesta API, mediana para
cantidad par/impar, mezcla indebida de perfiles y métricas, versiones
sustituidas, simulaciones, valores corruptos, IDs repetidos, base cero, fechas
iguales, huecos y variación de métodos.

## Límites

Las estadísticas son descriptivas y no sirven como medición médica,
predicción de evolución, diagnóstico ni evidencia de precisión clínica.
Solo se usan expedientes ficticios y se mantiene el gate de privacidad.
El avance de fase se reevaluará únicamente después de CI completa y revisión.
No modifica atlas 3D, Neon, Render, Vercel ni `main`.
