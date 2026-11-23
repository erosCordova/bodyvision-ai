# Fase 2 — Aceptación técnica de expedientes y mediciones ficticias

## Alcance y responsabilidades

Se añade un ensayo de Chromium y HTTP real contra el backend FastAPI y
PostgreSQL 15 **descartable**, no un mock: `frontend/tests/private-e2e/phase2-records.spec.ts`.
Es evidencia automatizada de funcionamiento y regresión del proyecto, no
recepción de producto/QA ni autorización para expedientes médicos reales.

Este bloque pertenece a **ChatGPT**; el trabajo en paralelo de **Arena** en
[issue #44](https://github.com/erosCordova/bodyvision-ai/issues/44)
está reservado a retención/recuperación de capturas cifradas ficticias de F4.
No hay modificación de las rutas ni workers de ese bloque.

## Recorrido de aceptación funcional comprobado

1. La cuenta administradora **ficticia** inicia sesión por el formulario de
   acceso privado y obtiene token de la API real.
2. Crea un expediente ficticio en la interfaz y edita su referencia. Recarga
   la página y verifica que la modificación sigue persistida en PostgreSQL.
3. Registra una medición OBSERVADA a través del formulario, recibe HTTP 201
   y la visualiza en la tabla de mediciones vigentes.
4. Inserta una fuente ficticia con segundos y **seis decimales de precisión**
   mediante API real. Reenvía el mismo payload y clave de idempotencia: el
   servidor retorna el **mismo ID**, no crea duplicados.
5. Rechaza un valor fuera de catálogo por HTTP 422; bloquea una corrección
   cuyo motivo tenga menos de cinco caracteres antes de llamar a la API.
6. Corrige el valor desde la interfaz **sin modificar la fecha**. Valida la
   cadena de versiones por HTTP y confirma que la corrección preserva
   **exactamente la cadena UTC con segundos/microsegundos original**, mientras
   solo la versión nueva permanece vigente. La interfaz expone el historial
   completo con valor original, valor corregido y motivo.
7. Archiva el expediente con confirmación explícita; recarga; los datos siguen
   consultables pero los controles de escritura quedan desactivados y la API
   rechaza escrituras aunque se intente evitarlos.
8. Una cuenta de otra organización ficticia recibe **404** al intentar leer el
   expediente, sus mediciones o su cadena de versiones. También se ensayan
   intentos ajenos de renombrar/archivar el expediente, crear mediciones o
   corregir versiones: la cuenta externa del fixture tiene rol **member**,
   por lo que las cuatro escrituras se rechazan con **403** antes de buscar el
   expediente; las lecturas ajenas continúan en **404**. Estos rechazos
   prueban prohibición de edición para el rol y aislamiento de lectura,
   pero no sustituyen una prueba entre organizaciones con rol editor. El autor todavía puede consultar el
   historial archivado con su sesión autorizada.

Se usan únicamente `browser.admin@example.invalid`,
`browser.outsider@example.invalid` y contraseñas de **fixtures** definidas por
`backend/tests/browser/seed_private.py`. Los IDs creados se generan de forma
única, nunca se utilizan expedientes reales ni dispositivos físicos.

## Ejecución y límites

La suite ya forma parte de `npx playwright test --config playwright.private.config.ts`
ejecutada por `BODYVISION CI`. La prueba individual tiene un presupuesto
máximo de 120 segundos: incluye el navegador, la API y el estado real de
PostgreSQL. El paso de navegador privado recibe un presupuesto de seis minutos
para no recortar la cobertura existente.

Criterios automáticos: checks de Windows, backend/migraciones, frontend/Vitest,
Chromium privado, Docker + restauración aislada, sin fallo. Los ensayos son
repetibles en PostgreSQL **efímero** de GitHub Actions. No se borran datos
del usuario y ninguna base productiva se conecta a esta suite.

### Pendiente de recepción independiente

- Aprobación funcional final de producto/QA de flujos, textos y permisos.
- Responsables reales de custodia, privacidad, seguridad y control de identidad.
- Dispositivos físicos objetivo y revisión clínica; no se autorizan datos reales.
- Verificación del flujo de usuario en equipos fuera del ambiente CI.

Una suite verde confirma **aceptación técnica en ambiente ficticio**, no cierre
formal o porcentaje de avance automáticamente mayor. No se modifica
`main`, no se fusiona sin revisión y no se despliega a producción.
