# ADR 0008 — Cuenta propia y cadena de auditoría privada

Estado: implementado para datos ficticios en desarrollo y CI. No habilita producción.

## Decisión

Cada usuario autenticado, incluidos los administradores, puede cambiar su propia
contraseña y cerrar sesiones propias. No se aceptan identificadores de usuario u
organización en el cuerpo: la identidad procede del bearer verificado. La lista
paginada muestra apertura, caducidad e indicador de sesión actual; no se recopilan
ni se inventan IP, dispositivo o ubicación. Nunca devuelve tokens ni sus hashes.

Cambiar contraseña o revocar sesiones exige confirmar la contraseña vigente.
Estas confirmaciones comparten un contador independiente del login y de las
acciones de soporte: cinco intentos en quince minutos. La verificación del hash
se repite bajo el bloqueo del usuario empleado por login, suspensión y
restablecimiento administrado. Cambiar contraseña revoca todas las sesiones
activas, incluida la actual. Revocar todas permite un nuevo login sin alterar
la contraseña. No hay recuperación pública ni envío de mensajes.

Un trigger encadena cada evento de seguridad por organización. La secuencia,
hash anterior y SHA-256 se calculan dentro de la misma transacción que el evento.
Una fila de cabecera bloqueada serializa las inserciones concurrentes sin depender
del orden de las marcas de tiempo. La cabecera también permite detectar la
eliminación del último evento. Los roles operativos no pueden consultar o cambiar
directamente ni los eventos ni las cabeceras; acceden por funciones restringidas.

El contenido canónico es un array JSONB UTF-8 con versión, secuencia, hash anterior,
identificador, organización, actor, correlación, acción, tipo/destino, resultado y
fecha expresada como segundos Unix con microsegundos. No incorpora contraseñas,
verificadores, tokens ni valores clínicos. La versión es `sha256-chain-v1`.

El administrador verifica todos los eventos de su organización mediante una
operación explícita. La respuesta identifica el punto comprobado, fecha, número
de eventos y primera inconsistencia. La comprobación misma queda auditada después
del punto comprobado. El rol de consulta no puede ejecutar esta verificación.

## Límites

La migración 0012 encadena registros anteriores estableciendo una línea base;
no demuestra su integridad previa. Los hashes detectan modificaciones o borrados
frente a la cabecera conservada, pero un propietario de base con privilegios para
reescribir toda la cadena y su cabecera puede reconstruirlas. No es una firma
externa ni un mecanismo de respaldo. Un anclaje externo y la verificación de
grandes volúmenes quedan pendientes antes de producción. La API conserva su
timeout SQL de tres segundos: una comprobación que lo exceda falla sin afirmar
integridad y sin confirmar eventos parciales.

El reseteo de tablas en pruebas se realiza exclusivamente con el rol propietario
de PostgreSQL desechable. No existe endpoint de limpieza ni permiso equivalente
para los roles de aplicación. La demostración pública conserva Neon en 0002 y
no recibe la migración. Render no aloja la base de datos.
