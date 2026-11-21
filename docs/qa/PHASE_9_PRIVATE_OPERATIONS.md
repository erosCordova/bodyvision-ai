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
de FastAPI e incluye el trabajo transaccional del endpoint; no mide descarga
completa, red del usuario, GPU ni FPS. No se muestra cero cuando faltan muestras.

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

La estimación de avance se revisará solo después de aprobar la ejecución CI
integral del nuevo código.
