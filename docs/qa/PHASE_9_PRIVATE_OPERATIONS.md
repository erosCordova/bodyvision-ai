# Fase 9 — estado operativo privado y avisos locales

## Funcionalidad

En Administración, «Estado del servicio» ofrece una consulta explícita para
administradores autenticados de local/test. No se inicia sondeo en segundo
plano al montar el panel. Cada consulta comprueba la conexión y revisión de
esquema de la base de datos y muestra respuestas recientes de la organización
verificada en ese proceso, P95 y resultado de retención automática del propio
proceso. Fallos de consulta eliminan la vista anterior y permiten reintentar;
un cambio de sesión o salida descarta respuestas tardías.

`GET /api/v1/auth/operations` verifica una sesión vigente con rol administrador.
Rechaza el selector de organización del cliente. Especialistas y miembros no
pueden leer el diagnóstico; la demostración pública no monta esta ruta.

## Aislamiento y límites de memoria

La organización procede exclusivamente de `resolve_identity`, después de
comprobar sesión y MFA cuando corresponda. Las peticiones anónimas o con sesión
no verificable no se atribuyen a ninguna organización. Los selectores de la
demo y los encabezados de usuario no alimentan el recolector. Las consultas a
este mismo panel tampoco alimentan su muestra, para evitar diluir incidentes.

Se retienen **hasta 256 respuestas por organización de los últimos 300 segundos**,
con hasta 64 organizaciones y expulsión por actividad más antigua. Se guardan
solo tiempo monotónico, código HTTP, duración y bandera de consulta interrumpida;
la clave de organización es interna y no sale en el diagnóstico. No se guardan
URLs, rutas, consultas SQL, cuerpos, coordenadas, expedientes, nombres o tokens.
Un bloqueo de hilos protege actualizaciones y copias de las muestras. Reiniciar
el proceso borra todos estos diagnósticos. No es un recuento exhaustivo de tráfico
ni un histórico persistente.

P95 usa rango más próximo. El tiempo termina al recibirse la respuesta interna
de FastAPI e incluye el trabajo transaccional del endpoint; incluye esperas de E/S y lectura del cuerpo dentro del endpoint; no mide
el RTT completo del usuario, la descarga completa, GPU ni FPS. No se muestra cero cuando faltan muestras.

Procedimiento de atención: `docs/operations/PRIVATE_SERVICE_DIAGNOSTICS.md`.

## Avisos verificables

- `server_failures`: al menos tres respuestas 5xx, o al menos cinco respuestas
  con fracción 5xx igual o superior al 20 %.
- `slow_responses`: al menos cinco respuestas y P95 igual o superior a 2000 ms.
- `query_interrupted`: al menos una excepción SQL con SQLSTATE 57014 tras
  verificar la organización. Ese código puede representar límite de tiempo
  **o cancelación**, no se afirma conocer la causa por su texto. El SQLSTATE
  crudo y la excepción no se exportan.
- `database_unavailable`: falla la consulta de revisión del esquema o la revisión
  no coincide. Esta consulta diagnóstica devuelve 200 con estado degradado;
  `/health/ready` conserva su contrato HTTP 503 cuando no está preparado.
- `retention_failed` / `retention_overdue`: última limpieza fallida o dos intervalos
  sin resultado. Un resultado satisfactorio recupera el estado. No se exporta
  cantidad borrada ni información de ninguna organización.

La limpieza indicada es la tarea alojada en el **mismo proceso API**. No se
atribuye a ese estado la ejecución del contenedor de mantenimiento independiente.
Con la tarea desactivada o sin su configuración requerida se muestra desactivada;
sin primera ejecución se muestra pendiente. El estado de retención es técnico
del proceso, mientras que las muestras de solicitudes se separan por organización.

## Comprobación y alcance

Las pruebas cubren expiración de ventana, memoria acotada, escrituras desde ocho
hilos, aislamiento, avisos y recuperación de retención; API con PostgreSQL para
roles, cambio de sesión, selector no confiable, interrupción simulada, fallo y
recuperación del sondeo de base; interfaz para fallos, reintento, muestra vacía y
respuestas tardías; recorrido real de navegador desde Administración.

Este incremento no activa staging/producción ni crea recursos, conexiones o
avisos externos. No es observabilidad centralizada: faltan agregación entre
procesos, histórico, supervisión cuando la API no responda, alertas fuera de la
aplicación, inventario/custodia, respaldos productivos y aceptación operativa.
No demuestra carga concurrente de producción ni exactitud clínica.

## Cierre técnico comprobado

[GitHub Actions 44841638430](https://github.com/erosCordova/bodyvision-ai/actions/runs/44841638430)
aprobó `native-checks`, `windows-scripts` y `docker-smoke` sobre el commit
`075a525a6e962042f4acc68eaf5ebbb9e944355a`. Hubo **203** pruebas backend,
**238** frontend, **36** de navegador público y **7** privado: **484** de
aplicación. La ejecución también verificó calidad, compilación, dependencias,
migraciones, arranque Docker, restauración aislada y conservación de datos
tras recrear contenedores. El recorrido administrativo consultó el diagnóstico
real, comprobó el contrato sin identificadores y cerró la sesión.

La estimación técnica manual de la Fase 9 pasa de **35 % a 45 %** por dos
entregables: observabilidad privada acotada con avisos (5 puntos), y recepción
del diagnóstico/recuperación con panel y procedimiento operativo (5 puntos).
El promedio de diez fases pasa de 79,5 % a **80,5 %**, mostrado como **81 %**.
No se alteran las otras fases ni se da por cerrado el criterio de producción.


## Vigilante independiente de indisponibilidad local (entrega posterior)

La observabilidad del panel ahora se complementa con el proceso separado
`app.workers.independent_service_watchdog`, bajo el perfil optativo
`watchdog`, exclusivamente local/test sintético. Puede informar sobre una
API caída desde fuera del proceso de la API. El proceso no recibe credenciales
ni escribe en PostgreSQL; limita la URL de destino al endpoint interno fijo,
prohíbe redirecciones y solo emite cambios de estado sanitizados a stdout.

La aceptación integral
[44861754261](https://github.com/erosCordova/bodyvision-ai/actions/runs/44861754261)
aprobó una caída real del backend Docker y la recuperación posterior,
junto con Windows, tests nativos, frontend y navegadores. Véase
`docs/operations/INDEPENDENT_SYNTHETIC_WATCHDOG.md`.

**Límites:** no hay alertas fuera del host, telemetría centralizada ni
disponibilidad cuando Docker o el anfitrión están apagados. Sigue
prohibido usar datos reales; esta prueba no es un SLA.


## Historial local bounded de incidentes del vigilante (55 % de Fase 9)

Después de la aceptación independiente, `watchdog_history.py` añade
persistencia en SQLite local, separada de la base y con un máximo de
256 transiciones y siete días. El proceso no almacena cuerpos HTTP,
usuarios, tokens, direcciones ni expedientes. Una nueva instancia consulta
su último estado antes de escribir, evita duplicados y presenta un historial
local acotado. El volumen privado tiene permisos restrictivos y el proceso
nunca se activa por defecto en la aplicación pública.

El [run 44863258689](https://github.com/erosCordova/bodyvision-ai/actions/runs/44863258689)
aprobó las pruebas de nueva instancia, expiración, límite y corrupción.
La prueba Docker registró una caída y recuperación reales, consultó ambos
eventos desde otro contenedor y comprobó que una lectura posterior no
generase una transición falsa. También finalizaron correctamente Windows,
backend, frontend y los navegadores públicos/privados.

La Fase 9 queda en **55 %**; faltan vigilancia fuera del host, histórico
centralizado, notificación externa, custodia de incidentes y preparación
productiva. Ningún incidente representa un paciente real.


## Resumen de incidentes con desenlace no observado

El módulo `watchdog_incidents.py` integra las transiciones locales ya
registradas por el vigilante sin abrir rutas HTTP nuevas ni acceder a
PostgreSQL. Agrupa degradaciones y caídas consecutivas en un incidente;
solo una nueva observación positiva permite marcar recuperación. El reporte
no calcula uptime, SLA ni tiempos reales de indisponibilidad. Excluye
datos individuales y se limita al entorno ficticio optativo.

La [CI 44865810489](https://github.com/erosCordova/bodyvision-ai/actions/runs/44865810489)
aprobó todos los jobs, incluidas 536 pruebas de aplicación, y la prueba
Docker de un episodio recuperado tras parada de la API. Los tests cubren
incidentes múltiples, datos ausentes, una caída sin recuperación
observada, cronología inválida, acceso autorizado y diario corrupto.

La Fase 9 queda en **60 %** por estimación técnica manual, con 84 %
global tras redondeo. El reporte no sustituye supervisión fuera de Docker
ni pruebas operativas reales.


## Vigencia de observaciones del vigilante (Fase 9: 65 %)

La tabla SQLite `watchdog_latest_probe` almacena únicamente un sondeo
reciente —estado, fecha UTC e intervalo— y sustituye el valor anterior
en cada comprobación. El modo local optativo `--status` diferencia
`never_observed`, `recent`, `stale` y `clock_inconsistent`, sin
consultar la API ni afirmar disponibilidad por un `ready` antiguo.
No se publican endpoints ni datos de expedientes; el volumen permanece
dentro del contenedor optativo de laboratorio.

La [CI integral 44926525791](https://github.com/erosCordova/bodyvision-ai/actions/runs/44926525791)
aprobó Windows, Docker, backend y frontend (542 pruebas de aplicación).
Las pruebas unitarias comprueban caducidad lógica del estado ante el
paso del tiempo, reloj invertido, estados/intervalos rechazados, una
sola fila tras reinicio y sondeos repetidos sin duplicar transiciones.
Docker comprueba el estado reciente desde otro contenedor al recuperar
la API. El procedimiento no demuestra SLA ni observa el host apagado.

Por alcance verificado, la Fase 9 pasa de 60 % a **65 %**, y el
promedio global manual de diez fases pasa de 84,0 % a **84,5 %**,
mostrado como **85 %** por redondeo.


## Puerta de integridad de respaldo sintético (Fase 9: 70 %)

El paso de restauración de CI ahora ejecuta
`scripts/verify_restore_manifest.py` antes de `pg_restore`.
Verifica cabecera de formato personalizado, tamaño dentro de un
límite fijo y digest SHA-256 contra un manifiesto generado
localmente con datos **exclusivamente ficticios**. El pipeline
altera deliberadamente una copia del respaldo, comprueba su
rechazo y solo entonces restaura el archivo original en
`bodyvision_restored_ci`, base efímera aislada. El respaldo
no se adjunta a artefactos ni se utiliza contra Neon.

La [CI 44927716849](https://github.com/erosCordova/bodyvision-ai/actions/runs/44927716849)
aprobó Windows, Docker, controles nativos, 542 pruebas de
aplicación y regresiones de scripts Linux/Windows. El paso Docker
de restauración con el nuevo gate terminó con éxito.

Con esta evidencia, la Fase 9 pasa de 65 % a **70 %**
por valoración manual; el promedio global sube de 84,5 % a
**85,0 %** (visible **85 %**). SHA-256 sin autenticación
no protege frente a sustitución simultánea de manifiesto
y respaldo. No equivale a respaldo cifrado/externo,
PITR, RPO/RTO o recuperación de infraestructura real.


## Simulacro con pila principal detenida (Fase 9: 75 %)

El ensayo Docker apaga frontend, backend y PostgreSQL principal;
con la base fuente detenida, restaura el respaldo sintético
verificado sobre una instancia PostgreSQL nueva, sin red y con
almacenamiento `tmpfs` aislado del volumen original.
Los roles globales necesarios por las políticas RLS se recrean
como identidades sin contraseña y `NOLOGIN`; se verifica
el estado vacío, zona horaria y la igualdad de los datos
y secuencias sin depender del orden físico del volcado.
Después destruye la instancia de recuperación, reinicia
la aplicación y comprueba disponibilidad en el laboratorio.

La [CI 44931458692](https://github.com/erosCordova/bodyvision-ai/actions/runs/44931458692)
terminó con éxito en Windows, pruebas nativas y Docker,
con **542 pruebas de aplicación aprobadas**.
El ensayo observó **18 segundos** para la reposición
dentro de un único runner, sin acreditar RTO productivo.
Tampoco demuestra pérdida física del host, restauración
en otra región, backups cifrados o custodiados, ni datos reales.

El progreso manual de la Fase 9 sube de **70 % a 75 %**;
el promedio global de 85,0 % a 85,5 %, visible como **86 %**.
