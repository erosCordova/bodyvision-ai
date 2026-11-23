# Fase 9 — Cronología monotónica del watchdog sintético

**Entorno:** solo local/test, con observaciones sintéticas en un volumen privado SQLite.
**Rama de integración:** `feature/phase3-auth-security`. Sin datos reales, conexiones externas ni producción.

## Fallo abordado

El proceso de vigilancia almacena el último estado observado y una secuencia acotada
de transiciones. Antes del cambio, dos instancias con retrasos de programación
podían escribir fuera de orden: un sondeo antiguo podía reemplazar el
`watchdog_latest_probe` más reciente, y una transición de fecha anterior
podía aparecer como último evento de SQLite por tener un ID posterior.
Esto distorsionaba la frescura observada y podía invalidar el resumen de incidentes.

## Contrato de la corrección

- `record_probe` abre la transacción con `BEGIN IMMEDIATE`, lee la fecha
  persistida bajo bloqueo de escritura y rechaza una observación anterior.
  No cambia el estado ni la fecha vigente en ese caso.
- `append_transition` aplica el mismo orden transaccional a la comparación
  con el último evento almacenado. Rechaza transiciones retroactivas antes
  de escribirlas; las repeticiones del mismo estado siguen sin duplicarse.
- Fechas persistidas inválidas o sin zona horaria se rechazan, en vez de
  generar una afirmación engañosa de disponibilidad.
- Se conserva el límite de **256 transiciones durante siete días** y el único
  registro de último sondeo; solo se almacenan estado y fecha, no datos
  de personas ni respuestas HTTP.
- Las pruebas reproducen dos instancias de SQLite sobre la misma ruta,
  una observación tardía, una transición retroactiva y un valor persistido
  deliberadamente dañado.

## Qué no certifica

Las transacciones serializadas garantizan consistencia del diario **dentro
de un mismo SQLite local**, no que los relojes de distintos equipos estén
sincronizados, ni un histórico externo durable. Rechazar una fecha anterior
hace fallar el sondeo de forma cerrada; el operador deberá revisar el reloj
y el registro. No se calculan porcentajes de uptime, SLA, RPO ni RTO.
Tampoco se obtiene evidencia sobre caída del host entero o restablecimiento
de redes, DNS, TLS o secretos de una instalación de producción.

## Evidencia técnica

La batería `backend/tests/unit/test_watchdog_history.py` se ejecuta en
`native-checks` de BODYVISION CI, junto a los ensayos Docker del watchdog.
Registrar el resultado real de Actions antes de marcar el PR listo para
integración. El avance manual de fase 9 se mantiene en **90 %** y el global
en **93 %** hasta recepción operativa externa.
