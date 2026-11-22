# F9 — Objetivos configurables y solicitudes atrasadas durante la revisión

Fecha: 22-11-2026. Alcance: cuentas y solicitudes ficticias local/test.

## Problema y comportamiento corregido

Antes, `review_overdue` y el filtro de atrasadas solo consideraban el estado
`received`. Iniciar revisión hacía desaparecer una solicitud atrasada del
filtro, aunque no estuviera resuelta. El objetivo estaba fijado en siete días.

Ahora los dos estados abiertos, `received` e `in_review`, conservan el aviso
cuando `review_target_at <= now()` en PostgreSQL. La respuesta de revisión,
el historial personal y la cola usan el mismo predicado. Filas, filtros y
recuentos se evalúan con el reloj de la transacción, sin depender de la hora
del navegador. Iniciar revisión no cambia `received_at` ni `review_target_at`.

`PRIVACY_REVIEW_TARGET_DAYS` configura el objetivo de las solicitudes nuevas:
entero de **1 a 30**, valor predeterminado **7**. Son días transcurridos de
24 horas. El servidor valida la configuración al arrancar; el solicitante
no puede incluir un plazo en el cuerpo HTTP. Recepción y objetivo se
persisten desde el mismo instante de PostgreSQL. Cambiar la configuración
y reiniciar la API no altera los objetivos ya guardados. La variable se
documenta en `.env.example` y se transmite al servicio backend de Compose;
esto no activa la identidad privada en la receta pública/local.

La interfaz muestra recepción y objetivo con zona **America/Lima** y denomina
el aviso «Atención interna atrasada». Conserva la advertencia de que iniciar
revisión no resuelve la solicitud. No hay nuevos estados de cumplimiento.

No se requieren cambios de esquema: la revisión actual `0029` conserva los
objetivos existentes. El cambio no concede permisos, modifica la autoría ni
amplía el acceso de la cola a expedientes sin concesión explícita.

## Validación local ejecutada

- PostgreSQL aislado y descartable **16**, roles separados, migraciones hasta
  `0029` y datos ficticios: **11 pruebas aprobadas** (5 de integración de
  privacidad y 6 de configuración). La versión PostgreSQL 15 requerida por
  el proyecto se verifica en CI, no se atribuye a este ensayo local.
- Se verificó atraso antes y después de iniciar revisión, conservación exacta
  del objetivo, historial personal, filtro por ambos estados, paginación con
  total correcto y desaparición de la cola al revocar el permiso.
- Nuevas solicitudes con objetivos de 7 y 2 días persistidos; configurar 30
  después no cambia ninguna. El cliente no puede inyectar `target_days`.
- **332 pruebas frontend aprobadas**, incluidas la nueva regresión de interfaz
  que conserva el aviso tras iniciar revisión y la hora 08:00 de Lima para un
  objetivo de las 13:00 UTC. TypeScript, ESLint y compilación aprobados.
- Ruff y formato de backend aprobados. El recorrido Playwright privado se
  amplió para comprobar siete días exactos y conservación del objetivo tras
  iniciar revisión; su ejecución integral queda pendiente de CI.

## Límites y avance

Este objetivo es una política interna de simulación configurable por instancia,
no un plazo legal ARCO ni una política por organización. No atiende, exporta,
borra ni cierra solicitudes reales. El rol `privacy_officer`, la verificación
legal de identidad, eliminación de respaldos y revisión externa siguen
pendientes. El avance manual permanece en **92,5 % / 93 % mostrado**: corregir
este defecto no equivale a superar las puertas externas de una fase.

La integración exige CI integral, Windows/Docker y retención independiente
aprobadas sobre el mismo cambio. Sin modificación de `main`, sin despliegue
y sin conexión a Neon o a una base con datos reales durante las pruebas.
