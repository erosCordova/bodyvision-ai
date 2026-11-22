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

## Continuidad administrativa tras renovar la sesión

Se corrige el cierre indebido de sesión en peticiones administrativas con
JWT anterior: renovación compartida, un solo reintento, respuestas tardías
acotadas a la misma autenticación y descarte de predecesores al salir o cambiar
de autenticación. El panel de invitaciones conserva su código de única
visualización durante la renovación y se desmonta al cambiar de identidad.

La [CI 45036597574](https://github.com/erosCordova/bodyvision-ai/actions/runs/45036597574)
aprobó `19131fe676c6e3ee003eaa88434e2b43ab59d6b0`: 430 pruebas backend,
312 frontend, 44 de navegador público, 11 privado y 3 de cookie, **800 en
total**, con Windows y Docker aprobados. La [retención 45036597674](https://github.com/erosCordova/bodyvision-ai/actions/runs/45036597674)
también fue exitosa. El caso nuevo comprueba la invitación real sin interceptar
HTTP: 401 anterior a la mutación, 201 tras renovación y un único registro.

**Sin incremento de estimación:** F3 95 %, suma 925, promedio 92,5 % exacto y
93 % mostrado. [Evidencia y límites](PHASE_3_ADMIN_SESSION_CONTINUITY.md).

## Continuidad de captura y pose con renovación compartida

Capturas y resúmenes de pose adoptan la misma renovación acotada de acceso
que administración y expedientes. Conservan PNG, payload mínimo y clave de
idempotencia. Cancelar una consulta o vencer su espera impide su reintento
sin cancelar la renovación que otra consulta necesita; los fallos inciertos
de red no repiten escrituras. El formulario conserva la operación de pose al
renovarse el JWT y descarta la confirmación al cambiar de identidad.

La [CI 45039841043](https://github.com/erosCordova/bodyvision-ai/actions/runs/45039841043)
aprobó `f5e9b2a032f8d490501fe22632be12560ab4b5de`: **430 backend, 328 frontend,
44 navegador público, 11 privado y 4 cookie = 817 pruebas de aplicación**;
Windows y Docker aprobados. La [retención 45039841169](https://github.com/erosCordova/bodyvision-ai/actions/runs/45039841169)
también fue exitosa. El navegador verificó subida única, preview conservada,
SHA-256 de descarga, borrado y guardado de pose tras rotaciones reales.

Se mantienen F4 y F5 en 90 %, suma 925 y media **92,5 % exacto / 93 % mostrado**.
[Evidencia y límites](PHASE_4_5_SESSION_CONTINUITY.md).
