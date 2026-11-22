# Prioridad de cierre de fases de BodyVision

Decisión del usuario: **terminar las fases del proyecto primero; después
conectar Figma y mejorar visualmente la interfaz**. Se conserva la interfaz
actual para completar los flujos funcionales y sus pruebas. Los cambios
visuales y la creación de componentes en Figma quedan para una etapa posterior.
El modelo anatómico elegido continúa como único cuerpo base.

## Trabajo de cierre

El orden de ejecución considera dependencias: identidad y privacidad antes
de admisión de datos; aceptación funcional y recursos antes de cierre operativo.
La numeración del tablero es 0–9 y su promedio usa diez fases con igual peso.
La evidencia técnica y las aceptaciones humanas se registran por separado.

| Fase | Próximo criterio de cierre |
|---|---|
| 0 · Descubrimiento | Revisar matriz de riesgos, responsables y aceptación del alcance. |
| 1 · Fundación | Cierre técnico local ficticio ya acreditado; conservar las regresiones. |
| 2 · Expedientes | Recepción funcional independiente y aceptación de producto/QA. |
| 3 · Seguridad | Identidad real, custodia externa de claves, anclaje de auditoría y revisión independiente; recuperación ficticia sin códigos ya aceptada. |
| 4 · Captura | Cierre de privacidad, inventario de copias/claves y retención fuera de la base activa. |
| 5 · IA de pose | Corpus independiente autorizado, recursos y dispositivos objetivo. |
| 6 · Visor 3D | GPU/dispositivos físicos y contraste con referencias morfológicas autorizadas. |
| 7 · Reportes | Autenticidad externa, persistencia final y recepción independiente. |
| 8 · Simulación | Validación morfológica y dispositivos físicos con criterios autorizados. |
| 9 · Operación | Custodia y recuperación externas, objetivos RPO/RTO, supervisión y recepción operativa. |

No se asignan firmas, aprobaciones clínicas ni resultados de hardware por
aprobar CI. Los puntos que necesiten responsables, referencias autorizadas
o un dispositivo físico se presentarán con su evidencia y decisión concreta
cuando sean el siguiente bloqueo de cierre. Las funciones privadas siguen
restringidas a datos ficticios y local/test hasta superar sus criterios.

## Interfaz posterior

Después del cierre de las fases se trabajará el diseño editable en Figma,
la coherencia visual, componentes y adaptación a pantallas. Esa etapa no
sustituye las pruebas funcionales, la arquitectura ni los criterios de cierre.

La recuperación asistida ficticia de la fase 3 fue aceptada en
[CI 44979515758](https://github.com/erosCordova/bodyvision-ai/actions/runs/44979515758)
con 647 pruebas de aplicación aprobadas. En esa revisión de 2026-11-21, seguridad se estimaba en 90 % y
el promedio global era 91,5 % (92 % redondeado). La reevaluación
posterior del 22 de noviembre, con F3 y F8 en 95 % y total 92,5 %
(93 % visible), está en [el informe de avance actualizado](PHASE_PROGRESS_REASSESSMENT_2026_11_22.md).
Esta entrega no equivale al cierre completo de todas las fases.

## Preparación de cierre de fase 0

La [propuesta de alcance, matriz de riesgos y responsables](PHASE_0_SCOPE_REVIEW.md)
está preparada para revisión y pendiente de aceptación del producto. Conserva
el objetivo de uso real del contrato y enumera las diferencias con el código
actual: identidad, storage, cola de pose, privacidad y operación. Los porcentajes
anteriores siguen siendo estimaciones técnicas del entorno ficticio, no cobertura
porcentual del contrato completo. No se incrementan por elaborar esta propuesta.
