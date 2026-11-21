# Fase 9 — vigilancia independiente de disponibilidad ficticia

## Alcance técnico

El diagnóstico de Administración depende de que la API esté disponible. Se agrega un proceso optativo, en otro contenedor, capaz de consultar la preparación de la API cuando el backend está detenido. No es un servicio de alerta externa ni una habilitación productiva.

- Perfil Docker watchdog: NO se inicia de forma predeterminada.
- Requiere APP_ENV local/test y BODYVISION_ENABLE_WATCHDOG=synthetic-only.
- Verifica HTTP 200, estado ready, PostgreSQL connected y revisión actual del esquema; respuestas inválidas y 503 se clasifican como degraded.
- Un fallo de conexión se clasifica como unreachable y la recuperación como ready.
- Emite una sola línea JSON por cambio de estado con evento, estado y fecha UTC. No emite URLs, identificadores, SQL, mensajes de excepciones, fotografías, datos de expedientes ni credenciales.
- Tiempo de espera de tres segundos, tamaño de respuesta de cuatro KiB, intervalo ajustable de 10 a 3600 segundos.
- Solo acepta el endpoint privado fijo backend:8000 o loopback 127.0.0.1:8000, sin proxy ni redirecciones, nunca rutas arbitrarias.
- El proceso independiente no recibe ninguna variable de base de datos, no publica puertos, no modifica datos, ejecuta el contenedor sin privilegios adicionales y con archivos de solo lectura.
- El modo de una consulta (--once) devuelve 0 si está preparado, 1 si no está disponible y 2 si el entorno no está autorizado.

## Validación

Las pruebas unitarias backend/tests/unit/test_independent_service_watchdog.py comprueban configuración restrictiva, códigos de respuesta, rechazo de otros orígenes, JSON sobredimensionado, falta de esquema y transiciones minimizadas. GitHub Actions detiene el backend en el entorno ficticio Docker, comprueba que el proceso detecte la caída, reinicia backend y comprueba la recuperación; vuelve a verificar la instalación.

## Límites

Los eventos quedan en stdout local. No hay alertas fuera del host, SLO medido, histórico centralizado, supervisión cuando Docker o el host completo estén apagados, ni integración con servicios de mensajería. Faltan control de credenciales productivas, infraestructura redundante, RPO/RTO, revisión de privacidad y aprobación operativa; no utilizar personas reales ni afirmar disponibilidad garantizada. No se despliega en Render, Vercel ni Neon.


## Evidencia de aceptación

El commit `ff21c135c27bb4f87a38abd5b260f86c31ddab83`
superó [BODYVISION CI 44861754261](https://github.com/erosCordova/bodyvision-ai/actions/runs/44861754261).
La prueba de Docker arrancó el vigilante como proceso independiente
sin credenciales, detuvo el backend y confirmó el estado `unreachable`
(código 1); lo reinició y confirmó `ready` (código 0). Aprobó
también las comprobaciones de esquema, retención, base restaurada y
recreación de contenedores. La suite nativa aprobó cuatro pruebas
unitarias de aislamiento y estados del vigilante.

## Historial mínimo de incidentes (local, optativo)

El perfil `watchdog` dispone de un volumen propio `watchdog_history`
para un diario SQLite aislado de PostgreSQL. Se conserva solo el estado
permitido y la fecha UTC, un máximo de 256 transiciones durante siete días.
El contenedor sin privilegios es propietario del directorio privado (0700);
el proceso usa umask 077 y no tiene credenciales de base de datos.

El modo `--history` permite consultar el diario sin depender del backend,
y cada nuevo proceso carga el estado persistido para no generar alertas
duplicadas después de un reinicio. Los registros no incluyen URL,
identificadores de usuario, pacientes, fotografías, SQL ni mensajes de error.
Un volumen inaccesible o dañado provoca salida explícita con código 3 y un
evento genérico, nunca un éxito ficticio.

La prueba Docker abre sucesivos contenedores, comprueba la caída y recuperación,
lee el historial y verifica que una segunda consulta no duplique la recuperación.
Esta persistencia local no equivale a copias seguras, supervisión externa
ni alertas cuando Docker o el host están apagados.


## Cierre de la prueba de persistencia

La [ejecución integral 44863258689](https://github.com/erosCordova/bodyvision-ai/actions/runs/44863258689)
aprobó sobre el commit `20263b74dd5ce339078452b06f7d7f04e3599764`
la caída y recuperación del servicio, la lectura del diario SQLite
desde un nuevo contenedor y la no duplicación de estados. Los
controles de caducidad y tope de 256 filas pasaron en la batería
backend. Esta evidencia es local y sintética; no acredita
supervisión externa ni recuperación ante pérdida del volumen.
