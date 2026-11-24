# Procedimiento de retención, claves y respaldos — capturas ficticias

**Ámbito:** solo entornos privados `local` y `test`. Prohibido usar este procedimiento como autorización de producción o como evidencia de cumplimiento sanitario. Las capturas son PNG sintéticos de hasta 256 KiB y se guardan cifradas; ningún dato clínico real está permitido.

## Controles implementados y verificables

- `CaptureCipher` cifra con Fernet usando `CAPTURE_ENCRYPTION_KEY`; las claves en `CAPTURE_DECRYPTION_KEYS` sirven exclusivamente para descifrar y reenvolver tokens antiguos.
- El endpoint de rotación exige administrador de prueba, verifica el resumen SHA-256 del contenido y actualiza los registros del perfil de manera transaccional. Si falta una clave o falla la integridad, se revierte la transacción del perfil. El límite actual es 5000 objetos examinados por operación.
- La lectura comprueba consentimiento vigente, autorización por expediente, vencimiento e integridad. La descarga incorpora `Cache-Control: no-store, private`, `Pragma: no-cache` y `X-Content-Type-Options: nosniff`. Estas cabeceras no permiten garantizar que el cliente no guarde manualmente una copia.
- El trabajador privado elimina por lotes de hasta 100 registros y 10 lotes por pasada. El intervalo permitido es de 60 a 86400 segundos; valor por defecto, 900 segundos. El proceso depende de que la API privada esté activa. Una interrupción puede retrasar la eliminación.
- La supresión de la tabla activa **no elimina por sí misma** copias en backups, snapshots, exportaciones, archivos descargados o logs históricos.

## Inventario obligatorio antes de modificar claves o política

Registrar fuera del repositorio, sin escribir secretos:

| Campo | Evidencia requerida |
| --- | --- |
| Identificador no secreto de versión de clave | Fecha de activación, servicio que la consume y responsable |
| Alcance de claves anteriores | Qué entornos y conjuntos de objetos dependen de cada versión |
| Almacenes de respaldo | Proveedor, región, tipos de copia, frecuencia y fecha de expiración |
| Cifrado de respaldo | Mecanismo, custodia de claves y prueba de restauración |
| Objetos expirados pendientes | Conteo consultado con rol autorizado; nunca volcar bytes ni tokens |
| Exportaciones/descargas | Política de expiración y responsable de destrucción |
| Evidencia de purga | Fecha, periodo consultado, cantidad y resultado de pruebas |

**No existe un inventario verificado de respaldos ni de versiones de claves en este repositorio.** No debe asumirse que hay PITR o borrado garantizado en Neon.

## Secuencia de rotación sin pérdida

1. Inventariar las ubicaciones cifradas y los respaldos, identificar la clave actual y las anteriores sin publicar sus valores.
2. Generar una nueva clave fuera del código fuente y configurarla como `CAPTURE_ENCRYPTION_KEY`; mantener las anteriores temporalmente en `CAPTURE_DECRYPTION_KEYS`.
3. Respaldar de forma cifrada y probar la restauración en infraestructura aislada antes de modificar el conjunto original.
4. Ejecutar la rotación autorizada para cada perfil de prueba. Registrar objetos examinados, rotados y fallidos **sin** bytes, claves, tokens ni datos identificatorios.
5. Validar la lectura de cada conjunto con la nueva clave, la integridad SHA-256 y los tests de autorización; repetir para objetos excluidos por vencimiento o por los límites de lote, si aplica.
6. Retirar una clave anterior solo después de comprobar que los objetos activos y las copias que se necesite recuperar ya no dependen de ella. Si quedan respaldos antiguos, conservar la capacidad de recuperación de manera protegida o dejar constancia explícita de la pérdida de recuperabilidad.
7. Tras revocar una clave comprometida, tratar como incidente cualquier copia que aún pueda depender de ella. La simple rotación del ciphertext no demuestra que el secreto anterior deje de representar un riesgo para respaldos preexistentes.

## Caducidad y restauración de respaldos: puerta de aprobación

La eliminación de filas vencidas no equivale a su desaparición inmediata de snapshots/PITR. Antes de admitir datos de personas reales se requiere una política aprobada con retención máxima por tipo de backup, fechas de expiración, tratamiento de copias externas, procedimiento de restauración aislada y pruebas documentadas de eliminación. No prometer borrado irreversible mientras existan snapshots recuperables, descargas no controladas o claves antiguas.

Una restauración desde un backup antiguo debe hacerse en un entorno aislado, validar el esquema, revocar accesos obsoletos y **volver a ejecutar la purga de registros vencidos antes de habilitar consultas**. Nunca habilitar automáticamente un respaldo restaurado como fuente de atención clínica.

## Verificación periódica

- CI: comprobar límites del trabajador de retención, fallos de ejecución, cifrado, rotación y descarga sin caché.
- Operación: revisar fallas de purga, tamaño de cola vencida, restauración con claves autorizadas y expiración real de snapshots.
- Escalar cualquier fallo de integridad, ausencia de clave, copia no inventariada o vencimiento incumplido; no ocultarlo con un indicador de éxito.

## Proceso de retención independiente de la API (solo sintético, optativo)

Existe un contenedor de mantenimiento separado en Compose bajo el
perfil `maintenance`, inicialmente **inactivo**. Ejecuta
`app.workers.independent_capture_retention`, con rol restringido
`bodyvision_app`, sin clave de captura, sin HTTP, sin exponer puertos,
sistema de archivos de solo lectura y sin privilegios adicionales.
No requiere que el servicio `backend` esté encendido, pero sí que
**Docker y PostgreSQL permanezcan funcionando**. No configura ningún
trabajo permanente externo ni borra respaldos.

El operador de un entorno sintético puede habilitarlo explícitamente
con `APP_ENV=local|test`, `IDENTITY_ENABLED=true` y
`BODYVISION_ENABLE_CAPTURE_RETENTION=synthetic-only`; nunca habilitar
en demo, staging, producción ni contra un host PostgreSQL remoto.
`docker compose --profile maintenance up -d capture-retention`
activa únicamente el sidecar y sus dependencias. Cuando se usa además
la limpieza en proceso del backend, la función PostgreSQL serializa
los lotes concurrentes mediante bloqueo de asesoría transaccional.
El worker admite una pasada controlada con el argumento `--once`
para diagnóstico sobre datos exclusivamente ficticios.

El sidecar verifica el rol de sesión conectado, rechaza credenciales
del propietario/migrador, impone un máximo de 100 filas por lote,
10 lotes por pasada e intervalos de 60 a 86400 segundos. Utiliza
la función de purga ya existente y conserva el contador de mantenimiento.
No descifra fotografías, no consulta su contenido ni crea rutas públicas.

Pruebas: unitarias para el rechazo de entornos no autorizados,
contraseñas/roles privilegiados, hosts remotos e intervalos inválidos;
integración PostgreSQL para eliminar solo un registro vencido sin usar
peticiones HTTP; CI Docker para detener `backend`, ejecutar el sidecar
una vez, confirmar que borra el elemento vencido y mantiene otro vigente,
y reiniciar la API.

**Límite de esta capacidad:** no hay limpieza si también están apagados
Docker o PostgreSQL; no equivale a eliminar bytes de WAL, respaldos,
descargas o snapshots. Los controles legales y de retención clínica
siguen pendientes.


**Evidencia CI de mantenimiento independiente:** la ejecución
[44833432116](https://github.com/erosCordova/bodyvision-ai/actions/runs/44833432116)
aprobó el test sintético en Docker con la API detenida y su reinicio
saludable posterior. No prueba que un programador externo esté activo
cuando Docker o PostgreSQL estén apagados.


## Inventario de vencidos visible para el administrador (21-11-2026)

En Administración → Estado del servicio, el administrador privado de
prueba puede pulsar **Comprobar capturas vencidas**. Es una lectura
acotada a sus expedientes con autorización explícita vigente. Devuelve
cantidad vencida, fecha de la más antigua y aviso si se alcanzan
1000 registros (en ese caso el total real no se conoce). Un recuento
cero tampoco cubre expedientes sin permiso, otras organizaciones,
backups, WAL ni ficheros descargados.

No ejecuta ninguna purga; las eliminaciones siguen a cargo del
trabajador de retención o del flujo autorizado. La ausencia de
capturas pendientes visibles **no equivale a eliminación verificable**.
Nunca contiene bytes, tokens ni identificadores de expedientes.

La CI 44971391963 validó las políticas RLS y, adicionalmente,
la comprobación explícita de concesión vigente por expediente,
con revocación efectiva, sin alterar el inventario consultado.
