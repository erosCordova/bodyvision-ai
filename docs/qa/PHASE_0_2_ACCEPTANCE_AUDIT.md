# BODYVISION AI — auditoría inicial de cierre de fases 0, 1 y 2

**Fecha:** 20 de noviembre de 2026 (America/Lima).  
**Rama auditada:** `feature/phase3-auth-security`, base `cf5dc60043eaab5b36a682535107e9fc17265fd4`.  
**Estado:** auditoría técnica y trazabilidad elaboradas; **no equivale a aceptación final ni firma**.

**Actualización posterior del mismo día, 13:37 (Lima):** se completó la
[recepción asistida de Windows](PHASE_1_WINDOWS_ASSISTED_RECEPTION.md): tras
el reinicio confirmado por el usuario, Chrome conservó las versiones 72/72/71 kg
y mostró API/SQL conectados. F1 alcanza **100 % de cierre técnico local**;
F0/F2 mantienen sus propios criterios y no se registra firma independiente.
El tablero actual queda en **76 % global estimado**. Las tablas y porcentajes
de las secciones siguientes describen la auditoría inicial, anterior a esta
evidencia, y se conservan como historial.

## 1. Dos numeraciones, un único seguimiento

El tablero toma **diez fases numeradas 0–9** del documento Arquitectura v3: la fase 0 es descubrimiento y diseño. El archivo de contrato implementable `docs/requirements/IMPLEMENTATION_SPEC.md` enumera **F1–F10**, en cuyo F1 comienza la fundación técnica y cuyo F10 es un piloto real. Se trata de **planes distintos y no de un simple desplazamiento**: su correspondencia se verifica por *entregable y criterio*, no por número. No cambiar los porcentajes del tablero ni declarar «piloto» como fase 9 por el solo parecido del índice.

La prioridad convenida es ahora **cerrar las fases por criterios de salida, empezando por la fase 0**, sin deshacer funcionalidades implementadas en otras fases.

## 2. Estado verificable de los tres primeros bloques

| Tablero | Contrato de ejecución | Lo que ya demuestra CI o documentación | Falta para aceptación final | Dictamen |
|---|---|---|---|---|
| Fase 0: diseño | Actividad preparatoria, fuera de F1–F10 explícitas | Reglas R1–R12, alcance no diagnóstico, ADR 0001 y arquitectura | Responsable de producto, aprobación del alcance, aceptación de riesgos y criterios | **Documentada; no aceptada** |
| Fase 1: fundación | F1: monorepo/API/UI/DB/Docker/CI | [CI #44110966237](https://github.com/erosCordova/bodyvision-ai/actions/runs/44110966237), [reporte F1](PHASE_1_REPORT.md): Docker, migraciones, salud, tests, navegador Chromium | Reproducción del alta por otra persona y conformidad operativa; matriz de navegadores manual | **Gate técnico verificado; recepción pendiente** |
| Fase 2: núcleo de datos | F2: expedientes, mediciones, historiales, derivadas | [CI #44116998812](https://github.com/erosCordova/bodyvision-ai/actions/runs/44116998812), [reporte F2](PHASE_2_REPORT.md), pruebas [API/RLS](../../backend/tests/integration/test_data_core.py) y [E2E](../../frontend/tests/e2e/data-core.spec.ts) | Aceptación funcional de producto; datos exclusivamente sintéticos; habilitación para sujetos reales corresponde a seguridad/legal posteriores | **Gate técnico verificado; recepción pendiente** |

**CI actual**: la última base de desarrollo superó [#44758471526](https://github.com/erosCordova/bodyvision-ai/actions/runs/44758471526). Eso prueba regresiones del repositorio en el runner, no firma de aceptación, compatibilidad Safari/iOS, ni despliegue legal.

## 3. Matriz preliminar de riesgos (sin falsificar aprobaciones)

| Riesgo | Nivel preliminar | Tratamiento propuesto | Estado / quién debe aceptarlo |
|---|---|---|---|
| Desfase de numeración F0–F9 frente a F1–F10 | Alto | Mapear por criterio en esta auditoría; prohibir cierre por coincidencia numérica | Pendiente: producto/ingeniería |
| Uso de datos sensibles antes de autorización | Alto | Mantener bloqueo para datos reales, revisión legal y clínica, pruebas de seguridad | Pendiente: legal/privacidad/seguridad |
| Un runner CI aprueba pero no equivale a alta humana | Medio | Solicitar recepción del entorno con la guía de instalación F1 | Pendiente: operaciones/QA |
| Aislamiento sintético confundido con autorización de usuarios reales | Alto | Separar identidad de F3, no tratar cabecera de workspace como autenticación | Pendiente: seguridad/producto |
| Porcentajes confundidos con aceptación formal | Medio | Mostrar por separado progreso estimado, gate técnico y firma pendiente | Pendiente: producto |
| No existe evaluación manual en Safari/iOS/Firefox y teléfonos físicos | Medio | Registrar pruebas por plataforma en QA antes del piloto | Pendiente: QA/operaciones |

La severidad es una evaluación inicial de ingeniería, **no una aprobación del responsable**. Deben asignarse responsables, probabilidad, fecha de revisión y aceptación expresa antes de considerar cerrada F0.

## 4. Criterios siguientes, concretos y sin duplicar trabajo

**F0:** un responsable del producto debe revisar alcance, limitaciones médicas, responsables y matriz preliminar. Solo entonces se registra aceptación; por ahora no hay firma.

**F1:** una persona distinta del implementador ejecuta [guía de alta](../operations/PHASE_1_HANDOFF_CHECKLIST.md) en equipo previsto, anota resultado, compatibilidad y bloqueo, y firma recepción. CI previo es evidencia del gate técnico, no de esa acción humana.

**F2:** QA/producto revisan con datos ficticios el flujo expediente → observación → corrección → historial → derivadas → cambio de organización. [Reporte técnico F2](PHASE_2_REPORT.md) y tests ya cubren las aserciones; faltan conformidad y revisión funcional independiente.

**Fuera de alcance de este bloque:** habilitar datos reales, certificar conformidad legal, ejecutar pruebas clínicas o cerrar F3/F4/F5. Se preservan `main`, base de datos y despliegues.

## 5. Control de versiones y progreso

Se **mantienen 85 % / 90 % / 90 %** en las fases 0–2 y **75 % global** del tablero porque son estimaciones manuales del alcance, no una tasa de tests; el estado técnico y la aceptación formal se exponen en campos separados. No aumentar a 100 % sin nueva evidencia y criterio firmado. La fecha de revisión de este cierre parcial se actualiza a 2026-11-20, sin inventar una decisión humana.
