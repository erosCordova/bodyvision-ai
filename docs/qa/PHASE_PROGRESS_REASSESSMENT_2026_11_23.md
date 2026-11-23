# BODYVISION AI — Revisión verificable de F5 y F9 (23-11-2026)

## Alcance y regla del porcentaje

La pantalla `/progress` representa **10 fases del tablero (F0–F9)**,
cada una con el mismo peso. No hay autoaprobación por abrir un issue,
subir un commit o completar tests de entorno ficticio.

| Fase del tablero | Estimación actual | Por qué no es 100 % |
|---|---:|---|
| F5 — IA de pose | 90 % | Faltan exactitud independiente, corpus autorizado, teléfonos reales y revisión clínica/privacidad |
| F9 — Operaciones/producción | 90 % | Faltan custodia externa de claves, PITR y copias remotas, supervisión fuera de host, RPO/RTO reales, DNS/TLS y aceptación de seguridad |
| Total de las diez fases | **93 %** | Promedio 92,5 %, redondeado; no constituye certificación |

## Evidencia técnica comprobada

Cada CI de la siguiente tabla terminó **SUCCESS** sobre la versión del
PR indicada; la evidencia es local/test con datos ficticios. Un nuevo
commit de integración puede disparar otra CI y no debe confundirse con
la ejecución ya aprobada del PR.

| Fase | PR integrado | Cambio específico | CI aprobada |
|---|---|---|---|
| F9 | [#65](https://github.com/erosCordova/bodyvision-ai/pull/65) | Monotonía del historial SQLite de watchdog | [45109270454](https://github.com/erosCordova/bodyvision-ai/actions/runs/45109270454) |
| F9 | [#67](https://github.com/erosCordova/bodyvision-ai/pull/67) | Aperturas no bloqueantes ante sustitución por FIFO de copia/manifiesto | [45110783389](https://github.com/erosCordova/bodyvision-ai/actions/runs/45110783389) |
| F9 | [#69](https://github.com/erosCordova/bodyvision-ai/pull/69) | Recuperación observada entre instancias con diario compartido | [45178363837](https://github.com/erosCordova/bodyvision-ai/actions/runs/45178363837) |
| F9 | [#71](https://github.com/erosCordova/bodyvision-ai/pull/71) | Vigencia de readiness, JSON sin duplicados y fecha UTC segura | [45186777102](https://github.com/erosCordova/bodyvision-ai/actions/runs/45186777102) |
| F9 | [#73](https://github.com/erosCordova/bodyvision-ai/pull/73) | Dos restauraciones desde copia privada verificada con manifiesto | [45192144525](https://github.com/erosCordova/bodyvision-ai/actions/runs/45192144525) |
| F5 | [#75](https://github.com/erosCordova/bodyvision-ai/pull/75) | Rechazo de WebP animado antes de bitmap | [45194601256](https://github.com/erosCordova/bodyvision-ai/actions/runs/45194601256) |
| F5 | [#77](https://github.com/erosCordova/bodyvision-ai/pull/77) | Rechazo de salida MediaPipe íntegramente fuera de cuadro | [45197375345](https://github.com/erosCordova/bodyvision-ai/actions/runs/45197375345) |
| F5 | [#79](https://github.com/erosCordova/bodyvision-ai/pull/79) | Detección APNG por chunks y negativa en Chromium sin subir datos | [45198782235](https://github.com/erosCordova/bodyvision-ai/actions/runs/45198782235) |

## Lo que estas pruebas NO certifican

- **F5:** fiabilidad diagnóstica, exactitud anatómica, diversidad de
  contextos reales, usuarios/consentimientos, ni hardware móvil físico.
- **F9:** la vigilancia del mismo host no observa la caída del host.
  La copia de backup de CI y su SHA-256 no proporcionan firma de origen,
  PITR, cifrado remoto ni custodia independiente. Los segundos del ensayo
  no son objetivos RTO/RPO productivos y no se dispone de aprobaciones
  externas ni de evidencias de restauración real en Neon.

## Decisiones necesarias para pasar del 93 %

- **Producto/QA:** aceptar por escrito criterios finales de flujo y
  nomenclatura de fases; revisar riesgos y personas responsables.
- **Especialistas clínicos y de privacidad:** aprobar corpus autorizado,
  límites de interpretación y uso de imágenes reales, con consentimiento.
- **Validación física:** probar latencia, RAM/GPU y comportamiento
  morfológico en teléfonos y equipos de distintas capacidades.
- **Operaciones y seguridad:** infraestructura real aislada, monitoreo
  independiente, backup offsite cifrado y bajo custodia, rotaciones,
  verificación de recuperación, RPO/RTO y plan de incidentes probado.
- **Firma final:** recepción formal por responsables designados. No se
  inventan firmas, autorizaciones ni ejecuciones productivas.

La revisión actualiza evidencia y fecha en `projectProgress.ts`,
pero **NO cambia valores de fases** ni activa producción. No se modifica
el único atlas anatómico elegido, `main`, Neon ni el despliegue.
