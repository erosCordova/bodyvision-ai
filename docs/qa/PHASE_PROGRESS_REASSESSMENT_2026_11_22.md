# BODYVISION AI — Reevaluación técnica del 22 de noviembre de 2026

**Rama de desarrollo:** `feature/phase3-auth-security`. Entorno
**local/test con datos ficticios exclusivamente**.

## Métrica, sin atribuir porcentajes a una ejecución de CI

El tablero usa diez fases 0–9 con igual ponderación; la cifra representa
una **estimación manual de cobertura técnica**, no la proporción de
requisitos con aceptación formal ni un porcentaje médico/operativo.

| Fase | Antes | Ahora | Justificación |
| --- | ---: | ---: | --- |
| 0 · Descubrimiento | 85 % | 85 % | Aceptación de alcance sin firmar |
| 1 · Fundación | 100 % | 100 % | Cierre técnico local ficticio, no autorización productiva |
| 2 · Expedientes | 95 % | 95 % | Recepción independiente de producto pendiente |
| 3 · Seguridad | 90 % | **95 %** | Invitaciones completas desde ambas interfaces, JWT/refresh rotatorio y expiración por inactividad; evidencia de CI y controles por expediente |
| 4 · Captura | 90 % | 90 % | Privacidad y copias fuera del sistema activo pendientes |
| 5 · IA de pose | 90 % | 90 % | Corpus autorizado y hardware físico pendientes |
| 6 · Visor 3D | 90 % | 90 % | GPU y referencia física pendientes |
| 7 · Reportes | 95 % | 95 % | Autenticidad externa/aceptación pendiente |
| 8 · Simulación | 90 % | **95 %** | Exportación íntegra de 25 escenarios en dos páginas verificada, con límite y seguridad |
| 9 · Operación | 90 % | 90 % | Operación externa/secretos/RPO-RTO pendientes |

**Antes:** 915/10 = **91,5 %**, el tablero mostraba 92 %.

**Después:** 925/10 = **92,5 %**, redondeado con `Math.round`
a **93 %**. El incremento corresponde a dos entregables específicos,
sin alterar la estimación de ninguna otra fase ni asignar firmas.

## Evidencia verificable

- **Fase 3:** [CI 45031910896](https://github.com/erosCordova/bodyvision-ai/actions/runs/45031910896)
  y [retención independiente 45031910845](https://github.com/erosCordova/bodyvision-ai/actions/runs/45031910845),
  ambas exitosas sobre el commit `b435c1d2`. Incluyen invitaciones
  por UI y backend, validación por navegador, backend/DB, Windows y Docker.
  La advertencia de inactividad de dos minutos es un desarrollo posterior
  y no se dará por aprobada hasta el CI del commit correspondiente.
- **Fase 8:** [CI 45003403081](https://github.com/erosCordova/bodyvision-ai/actions/runs/45003403081)
  y [retención independiente 45003403175](https://github.com/erosCordova/bodyvision-ai/actions/runs/45003403175),
  ambas exitosas sobre `ee5ab42a`. Validación de CSV con control de
  origen, prohibición de datos observados, campos permitidos y recuperación
  de historial de varias páginas.

## Puertas que todavía bloquean el cierre

El 95 % de una fase no indica que haya superado sus **gates externos**.
Seguridad exige identidad real verificada, custodia externa de secretos,
anclaje externo de auditoría, revisión legal/privacidad y recuperación
asistida aprobada para personas reales. Simulación exige comparaciones
independientes con morfología autorizada, dispositivos/GPU físicos y
evaluación clínica antes de proclamar reproducibilidad sobre personas.

Los gates humanos de fases 0 y 2 tampoco se aprueban automáticamente.
No se desplegó, ni se fusionó con `main`, ni se utilizaron expedientes
de personas reales. La decisión de ajustar F3 y F8 son **dos incrementos
manuales de cinco puntos por fase** sustentados en evidencia técnica,
no porcentaje de pruebas ni sustitución de revisiones externas.
