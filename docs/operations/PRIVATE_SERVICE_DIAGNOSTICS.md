# Consulta y atención de avisos del entorno privado ficticio

Este procedimiento se limita a local/test, con datos ficticios y un administrador
verificado. No habilita producción, no concede permisos y no cambia claves,
expedientes ni la base alojada.

1. Abrir **Administración → Estado del servicio → Consultar estado del servicio**.
   Leer la fecha de consulta en Lima. El resultado corresponde al instante indicado
   y a ese proceso; hay que consultar de nuevo para comprobar una recuperación.
2. Revisar el tamaño de muestra. «Sin muestras» no demuestra disponibilidad ni una
   latencia nula. La muestra contiene hasta 256 respuestas autenticadas propias
   de los últimos cinco minutos. Otros procesos, peticiones anónimas, intentos
   con sesión no verificable y consultas de este panel no se agregan aquí.
3. Atender el aviso concreto según la tabla. Los rechazos 4xx se distinguen de
   fallos 5xx: una denegación de permiso no es por sí misma una caída del servicio.

| Aviso | Verificación y siguiente acción |
|---|---|
| Consulta interrumpida | Revisar los logs JSON sanitizados por hora/correlación. SQLSTATE 57014 puede ser límite o cancelación; no asumir un interbloqueo. El panel no autoriza ampliar tiempos, reintentar escrituras automáticamente ni desactivar auditoría. Investigar antes de repetir una operación cuyo resultado sea incierto. |
| Fallos o respuesta lenta | Comparar cantidad, fecha y P95; con pocas muestras P95 puede ser el máximo. Revisar si se repite al consultar más tarde. Las pruebas de navegador con fixtures compartidos se ejecutan secuencialmente; no constituyen un ensayo de capacidad productiva. |
| Base no disponible o esquema incompatible | Comprobar el estado HTTP de `/api/v1/health/ready` y la revisión esperada por esa versión de aplicación. Revisar configuración y roles sin copiar cadenas de conexión. No aplicar migraciones sobre Neon automáticamente desde este procedimiento. |
| Limpieza fallida | Revisar el último intento de la tarea y el evento seguro `synthetic_capture_retention_failed`. La tarea conserva su próxima ejecución programada. No borrar capturas vigentes ni suprimir consentimientos para limpiar un aviso. |
| Limpieza retrasada | Verificar que el proceso API sigue activo y que su tarea está configurada. Dos intervalos sin resultado activan el aviso. El estado no observa el contenedor de mantenimiento independiente ni sus ejecuciones. |
| Limpieza desactivada | Es un estado de configuración, no un éxito de purga. Distinguir la tarea del proceso API del servicio independiente. Claves y mantenimiento solo se gestionan mediante sus procedimientos aprobados para datos ficticios. |
| El propio panel no responde | La vista anterior se elimina para evitar presentarla como actual. Reintentar la consulta; verificar conectividad y autenticación. Una API caída o una caída del motor de identidad requiere supervisión externa, todavía pendiente. |

4. Consultar de nuevo después de investigar. Los fallos HTTP se eliminan de la
   ventana al caducar o al salir de la muestra limitada; eso no demuestra que su
   causa haya desaparecido. Un sondeo de base satisfactorio comprueba solo ese
   instante. La retención se recupera cuando termina un intento satisfactorio.
5. Al documentar un incidente, registrar fecha, versión y categorías necesarias.
   No copiar tokens, semillas, claves, SQL, fotografías ni datos de expedientes
   en incidencias públicas. Este panel no envía mensajes ni crea alertas externas.

Los contadores se reinician con la aplicación. Este procedimiento no sustituye
histórico centralizado, avisos externos, ensayos de RPO/RTO, una restauración
productiva, revisión de carga simultánea ni recepción operativa independiente.


## Diagnóstico específico de capturas vencidas

La consulta **Comprobar capturas vencidas** no depende del contador de
respuestas recientes: obtiene el inventario de PostgreSQL exclusivamente
bajo identidad de administrador local/test y concesiones explícitas
de acceso a cada expediente. Una muestra de 1001 filas permite
distinguir el recuento exacto hasta 1000 de «al menos 1000».
Solo se muestra la cantidad y la fecha más antigua, sin fotos,
códigos personales ni identificadores. La consulta **no borra**.
Si no devuelve resultados, no implica que la organización completa,
los backups o el disco estén libres de capturas expiradas.

Validado con CI 44971391963 en PostgreSQL y navegador; requiere
revisión humana de políticas de eliminación y custodia de respaldos
antes de cualquier dato real.
