# Simulacro de restauración PostgreSQL (CI sintética)

## Objetivo

Comprobar que el respaldo **lógico completo**, generado con `pg_dump`
en formato personalizado, puede restaurarse en PostgreSQL 15 y que el
contenido de los registros ficticios coincide con el origen.

Este control es parte de los pendientes de la Fase 9. No equivale a una
política de respaldo productivo ni demuestra recuperación ante desastre.

## Aislamiento y secuencia

La acción `docker-smoke` inicia la aplicación con datos ficticios y
ejecuta pruebas contra `db-test`, un contenedor efímero aislado de
`db`. Luego:

1. Se produce un respaldo completo desde **db**, con credenciales locales
   generadas exclusivamente por CI; no se utiliza Neon.
2. Dentro de **db-test** se crea `bodyvision_restored_ci`, un destino
   adicional que no sustituye la base principal ni la base de tests.
3. `pg_restore` restaura tablas, índices, vistas, funciones y datos.
   La restauración falla inmediatamente si una instrucción falla.
4. Se exportan únicamente los datos de la base restaurada y se comparan
   mediante SHA-256 con la instantánea obtenida antes de las pruebas;
   se excluyen solo las claves aleatorias de protección de `pg_dump`.
5. Se destruye la base de restauración **de prueba** y se borran
   los archivos temporales en el runner. La limpieza final de CI
   elimina los contenedores descartables.

## Evidencia de ejecución

La acción [BODYVISION CI #44806178898](https://github.com/erosCordova/bodyvision-ai/actions/runs/44806178898) ejecutó satisfactoriamente el job `docker-smoke`, incluido el paso «Verify synthetic PostgreSQL backup restoration in isolated test database».

Esto demuestra restauración lógica en **un entorno descartable**, no recuperación productiva, certificación sanitaria ni aprobación de todos los jobs de la misma ejecución.

La valoración manual de la Fase 9 pasa de **30 % a 35 %** por este control ya comprobado. Con diez fases igualmente ponderadas, el progreso global sube de 76 % a **77 %** por redondeo de 76,5 %. No se atribuyen avances clínicos ni de producción que no consten.

## Criterios y limitaciones

El paso aprueba únicamente si la restauración termina sin error y el
contenido lógico ficticio coincide. No modifica la base local del usuario
ni la instancia alojada. No contiene datos reales. La prueba no demuestra
PITR, replicación, restauración entre versiones mayores, cifrado del
respaldo en reposo, retención, RPO/RTO, disponibilidad geográfica, custodia
de claves, copias externas ni recuperación de fotografías privadas.
Estas obligaciones siguen **pendientes** antes de cualquier uso médico.
No se deben subir a artefactos los archivos `.dump` o `.sql`.

La prueba se incorpora antes de los recorridos de navegador Docker y
el resultado debe confirmarse en GitHub Actions. La Fase 9 conserva
provisionalmente su porcentaje hasta validar el nuevo control.


## Puerta adicional de integridad SHA-256 anterior a la restauración

Se añadió el comprobador `scripts/verify_restore_manifest.py`
al simulacro **exclusivamente sintético** de GitHub Actions.
Antes de llamar a `pg_restore`, comprueba la cabecera del formato
personalizado `PGDMP`, tamaño acotado, archivo regular, y que
SHA-256 y bytes coincidan con un manifiesto creado inmediatamente
después del respaldo. El manifiesto registra solo formato, alcance,
tamaño y resumen; **no incluye contenido, SQL, datos ni contraseñas**.
Rechaza sobrescribir un manifiesto existente, enlaces simbólicos,
archivos dañados, truncados, vacíos o de otro formato.

La CI crea deliberadamente una **copia alterada** del respaldo y exige
que el comprobador la rechace **antes** de restaurar el respaldo
original en `db-test`. Después conserva la comparación lógica ya
existente del contenido restaurado. Los tests de scripts también
cubren opt-in exclusivo `APP_ENV=test`, `CI=true`,
`BODYVISION_RESTORE_DRILL=synthetic-only`, JSON manipulado y errores
sin revelar contenido.

Este control detecta corrupción accidental o discordancia con el
manifiesto; **SHA-256 no es una firma autenticada** y un atacante que
pueda reemplazar simultáneamente el respaldo y el manifiesto podría
recrear ambos. No cifra el respaldo, no lo envía a otra ubicación,
no prueba recuperación productiva ni establece RPO/RTO. Los archivos
de respaldo y manifiesto se eliminan del runner; no son artefactos
descargables de CI.


## Ensayo de pérdida del servicio principal y restauración sobre almacenamiento nuevo

Como ampliación del paso `docker-smoke`, GitHub Actions detiene
**frontend, backend y PostgreSQL principal** después de crear y
verificar el respaldo ficticio. En ese estado, comprueba que
el contenedor original de PostgreSQL está detenido. Levanta
después **otro PostgreSQL 15** con un nuevo sistema de archivos
temporal (`tmpfs`), sin conexión de red (`--network none`) y sin
montar los volúmenes de la aplicación.

La prueba comprueba que el destino tiene inicialmente cero tablas de
usuario; vuelve a verificar el respaldo contra su manifiesto,
lo restaura en el PostgreSQL aislado y compara la exportación
lógica de los datos recuperados con la instantánea anterior
mediante `verify_restored_data.py`, que conserva multiplicidad de filas,
columnas y secuencias sin depender del orden físico del clúster.
`verify_test_isolation.py` conserva la comparación estricta para la
preservación de la misma base. No depende de que la base
principal esté levantada para realizar esa restauración.

Solo después de superar esa comparación destruye el PostgreSQL
alternativo, vuelve a levantar la aplicación original y
verifica su instalación saludable. El proceso informa del tiempo
transcurrido en **ese ensayo de CI**, sin denominarlo RTO ni
imponer una garantía de plazo. El archivo de respaldo y las
exportaciones permanecen exclusivamente en el runner descartable
y se eliminan tras la prueba.

**Límite fundamental:** la recuperación ocurre en un
contenedor aislado pero **dentro del mismo runner de GitHub**.
No representa una caída física del servidor anfitrión,
almacenamiento geográficamente separado, copias productivas
ni claves cifradas. Tampoco demuestra recuperación real ante
pérdida del host ni restauración de datos privados fuera de
PostgreSQL; esas tareas requieren infraestructura y
procedimientos específicos antes de admitir datos clínicos.


## Ajuste de recuperación: roles globales referenciados por RLS

La primera ejecución del ensayo de reposición detectó correctamente
que `pg_dump` **no incluye los roles globales del clúster**.
Las políticas de seguridad por filas (RLS) del esquema hacen referencia
a `bodyvision_app` y `bodyvision_auth_app`; por ello,
`pg_restore --exit-on-error` rechazó un PostgreSQL recién creado
que no poseía dichos roles, antes de declarar la recuperación aprobada.

El ensayo ahora prepara esas dos identidades **solo en la instancia
de CI desconectada**, como roles `NOLOGIN`, sin contraseñas,
superusuario, creación de bases, herencia ni capacidad de saltarse
RLS. Comprueba su presencia y que no admiten login antes
de restaurar. **No importa secretos ni roles productivos.**
Para un procedimiento real serían necesarios inventario,
aprovisionamiento seguro y comprobación independiente de roles,
permisos y secretos de la infraestructura destino.

El ensayo aceptado en `44931458692` usaba `--no-owner --no-acl`: no restauraba propietarios ni
permisos GRANT. Los roles del destino permanecen `NOLOGIN` y no
se conecta la API a la base recuperada. Por tanto, este control
demuestra recuperación del esquema y contenido ficticios, pero
no demuestra que la aplicación pueda operar sobre el reemplazo
con sus credenciales, permisos RLS y claves. Ese criterio sigue
pendiente, separado del reinicio posterior de la aplicación original.


## Comparación semántica de datos en clústeres separados

La segunda ejecución del ensayo restauró completamente el esquema
del PostgreSQL de reemplazo, incluidos los roles requeridos,
pero detectó diferencias al comparar **byte por byte** los volcados
SQL de dos clústeres distintos. Ese método también compara orden
físico de exportación y metadatos no clínicos del `pg_dump`,
que pueden variar sin que cambie ningún valor almacenado.

La comprobación estricta existente `verify_test_isolation.py`
**permanece intacta** para el control de preservación de la misma
base. Exclusivamente para verificar una restauración independiente,
se añade `scripts/verify_restored_data.py`, que compara:
identificadores de las tablas y orden de columnas de cada bloque COPY;
el multiconjunto exacto de filas (con duplicados y cantidad);
sentencias de datos INSERT y estados de las secuencias. Se usan
resúmenes SHA-256 de cada fila y se ordenan para que no importe
el orden de exportación. Cualquier fila añadida, ausente, duplicada
o modificada, una columna alterada, un cambio de secuencia o
un volcado incompleto hace fallar la prueba.

El comparador evita imprimir valores de filas, direcciones o SQL,
limita el tamaño y la cantidad de filas, rechaza instrucciones
de modificación inesperadas y devuelve solo eventos técnicos
genéricos. Los tests de Windows y Linux prueban explícitamente
que cambios de valores y duplicados siguen detectándose.
Este método no reemplaza la prueba de restauración del esquema
ni implica validación clínica. 


## Consistencia de representación temporal durante la comparación

La prueba de restauración independiente identificó diferencias en tres
tablas que contienen observaciones y fechas (`organizations`,
`profiles`, `measurements`), mientras las secuencias coincidían.
El PostgreSQL principal usa `TZ=America/Lima`; una instancia
`initdb` nueva sin esa variable puede serializar columnas
`timestamptz` con una zona horaria diferente en `pg_dump`
aunque representen los mismos instantes.

El ensayo ahora lee `SHOW TimeZone` del origen **antes de
detenerlo**, inicia el PostgreSQL temporal con `TZ=America/Lima`
y exige que `SHOW TimeZone` coincida exactamente en ambas bases.
Luego mantiene la comparación de filas y secuencias sin omitir
valores de fechas. No constituye una conversión de datos clínicos
ni un reemplazo de la revisión de integridad.


## Aceptación final del simulacro con pérdida de la pila principal

Tras corregir las dependencias de roles RLS y la configuración
horaria, la [ejecución integral 44931458692](https://github.com/erosCordova/bodyvision-ai/actions/runs/44931458692)
sobre `86cd17d727e291fb1525ed9ca20a22258dbb662c`
terminó con **success** en los tres trabajos:
Windows, `native-checks` y `docker-smoke`. También pasó
la aceptación independiente de retención de postura.
La suite aprobó 255 pruebas backend, 243 frontend,
36 de navegador público y 8 privado.

La prueba real de Docker aceptó una restauración en una base
completamente nueva y temporal, sin red, mientras PostgreSQL
principal estaba detenido; verificó las tablas y secuencias
sin imprimir filas, destruyó el destino, recuperó la pila
original y confirmó que estaba saludable.
El procedimiento tomó **18 segundos en ese runner**:
es un dato observado del laboratorio, **no RTO ni SLA**.

**Pendiente:** copias y secretos custodiados fuera del servidor
real, almacenamiento redundante, políticas de caducidad,
verificación bajo pérdida física del anfitrión, infraestructura
reemplazable y continuidad operativa aprobada para datos reales.

## Ampliación: aceptación de la aplicación sobre el reemplazo

La nueva versión conserva las ACL del respaldo y las restaura con
`--no-owner`, incluyendo GRANT por columna/función y las revocaciones
a PUBLIC. Reasigna la propiedad al administrador ficticio del destino;
no recupera roles globales, contraseñas ni secretos desde el dump.

Antes del respaldo, `backend/tests/recovery_acceptance.py prepare`
crea dos cuentas ficticias de organizaciones distintas y conserva un
PNG sintético mediante la API privada, con sus dos aceptaciones.
Un archivo de estado privado del runner guarda la clave Fernet,
credenciales y sesión de prueba **fuera del respaldo**. No se adjunta
a artefactos y se elimina mediante un trap, también ante fallos.
La comparación de filas se hace contra la instantánea posterior a
estas fixtures, después del control previo de aislamiento de tests.

El PostgreSQL recuperado exige SCRAM para conexiones TCP. El modo
`verify`, ejecutado en su espacio de red aislado y mientras la base
principal sigue apagada, habilita los roles de prueba con las
credenciales efímeras externas. La aplicación usa conexiones LOGIN
reales de `bodyvision_app` y `bodyvision_auth_app`, sin SET ROLE ni
motor de propietario inyectado. Comprueba:

- Roles separados, sin superusuario ni BYPASSRLS; contraseña errónea
  rechazada, RLS sin contexto y aislamiento entre organizaciones.
- Denegación SQL de hashes de contraseña al rol de datos y de
  ciphertext al rol de autenticación.
- Readiness, sesión anterior al respaldo, login nuevo, acceso privado,
  escritura/lectura de una medición y cadena de auditoría válida.
- Descarga exacta del PNG recuperado con su clave externa; sin clave
  o con una clave incorrecta la API rechaza entregar los bytes.
- Logout de la sesión recuperada y denegación posterior por revocación.

La aceptación usa FastAPI TestClient con PostgreSQL real, sin mocks de
persistencia; no es una prueba HTTP por socket ni de navegador sobre
el reemplazo. No incluye recuperación MFA, custodia productiva de
secretos, reinstalación de frontend, PITR ni pérdida física del host.
El paso de restauración del job `docker-smoke` de
[CI 44935709054](https://github.com/erosCordova/bodyvision-ai/actions/runs/44935709054)
aprobó sobre `56e45426d4f080e5118764bd0fab91491f4fc49b`.
Se observaron `synthetic_recovered_application_prepare_verified`,
`synthetic_recovery_data_verified` y
`synthetic_recovered_application_verify_verified`, seguidos del
reinicio saludable de la instalación original. Docker terminó con éxito.
La ejecución integral terminó con **success** en Windows,
`native-checks` y `docker-smoke`: **557 pruebas de aplicación**
aprobadas (270 backend, 243 frontend, 36 navegador público y 8 privado),
además de las comprobaciones de scripts y del ensayo de recuperación.

La comprobación negativa detectó que declarar únicamente
`POSTGRES_HOST_AUTH_METHOD=scram-sha-256` conservaba reglas TCP
locales `trust` en este clúster nuevo. El destino ahora se inicializa
con `POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 --auth-local=trust`.
La conexión TCP con una contraseña aleatoria debe fallar por autenticación;
un error de red no satisface ese control. Los comandos de administración
por socket permanecen internos al contenedor desconectado.

El cliente de aceptación usa el host permitido `127.0.0.1`; no se amplió
la lista de hosts de la aplicación para admitir el nombre `testserver`.
La escritura de prueba se fecha dos horas atrás, antes del dato atípico
de 84 kg creado por el seed una hora atrás. No se desactiva ni se
confirma automáticamente la advertencia de valores atípicos para probar
una escritura normal sobre el reemplazo.

## Ampliación de recuperación MFA

El runner añade una tercera cuenta ficticia con MFA activado antes del
respaldo mediante los endpoints de enrollment y confirmación. Guarda
fuera del dump una clave Fernet MFA distinta de la clave de capturas,
la semilla del autenticador, códigos de prueba y una sesión MFA verificada.
Consume un código de recuperación antes de respaldar, para comprobar
que restaurar no lo vuelve a habilitar. Este estado temporal no se
adjunta a artefactos y mantiene los controles de acceso y limpieza.

Sobre el reemplazo, un cliente con `mfa_enabled=true` comprueba la sesión
MFA restaurada, rechazo de contraseña sola, TOTP válido y rechazo de
repetición, código de recuperación intacto y consumo único. Sin clave MFA
la configuración no puede iniciar con MFA habilitado; con una clave
equivocada el login falla sin entregar token. Los roles de datos y auth
no pueden leer directamente semillas cifradas ni verificadores de códigos.

También reemplaza el factor usando contraseña y otro código válido:
comprueba semilla nueva, revocación de todas las sesiones anteriores,
confirmación del nuevo factor, ocho códigos nuevos, rechazo de un código
antiguo todavía no usado y cadena de auditoría válida tras las operaciones.
El reloj es real; si la restauración termina en el mismo intervalo TOTP,
se utiliza el siguiente paso permitido por la ventana existente de +1,
sin esperas ni modificación del reloj de la aplicación.

El evento `synthetic_recovered_mfa_verified` solo se emite al aprobar
todas estas comprobaciones. La ampliación fue aceptada en la
[CI integral 44939248415](https://github.com/erosCordova/bodyvision-ai/actions/runs/44939248415),
commit `0eba8fd7ae21bcc20db08d1c2bfe0cb11e91a5f9`, con Windows,
pruebas nativas y Docker aprobados y 562 pruebas de aplicación.
La evidencia completa figura en `docs/qa/PHASE_9_RECOVERED_MFA.md`.
No demuestra custodia productiva de
secretos, recuperación sin claves/códigos ni seguridad ante un operador
que deshabilite deliberadamente MFA en la configuración.

## Ampliación de interfaz y HTTP real sobre el reemplazo

Tras las comparaciones y la aceptación MFA, el runner conserva dos
códigos nuevos de recuperación en el mismo archivo privado. Inicia
Uvicorn con roles LOGIN limitados y MFA habilitado, enlazado a
`127.0.0.1:8000`, y un frontend Vite local/test en `127.0.0.1:5174`.
Ambos contenedores comparten únicamente el espacio de red de la base
recuperada; esta sigue con `--network none`, sin volúmenes originales
ni puertos publicados. La API monta el estado solo para lectura y
el frontend no recibe claves ni monta ese archivo.

La imagen `recovery-web` deriva del build con activos verificados, pero
sirve la interfaz en modo DEV para el acceso privado local/test.
Se conserva la condición `import.meta.env.DEV` del acceso privado;
no se habilita autenticación privada en el build público de producción.

Chromium se ejecuta con el UID/GID del runner dentro del mismo espacio
de red mediante `nsenter`, manteniendo su sistema de archivos. La base
principal debe continuar detenida. Un recorrido por HTTP real comprueba
ingreso MFA, consulta de mediciones, registro desde el formulario,
logout y revocación, nuevo ingreso y lectura de la escritura, y acceso
denegado a otra organización. No hay mocks de API o persistencia.

La configuración del navegador exige el opt-in test/CI/synthetic-only.
No captura vídeo, screenshots ni trazas. Incluso los contextos de
error automáticos de Playwright se escriben en el directorio privado
temporal, fuera de `frontend/test-results` y de los artefactos publicados.
Un reporter sanitizado emite solo estado y nombres estáticos de etapas;
no muestra errores, valores de formularios, tokens ni respuestas HTTP.
El trap destruye los contenedores y archivos privados ante éxito o fallo.

Esta ampliación fue aceptada en la
[CI integral 44942197913](https://github.com/erosCordova/bodyvision-ai/actions/runs/44942197913),
commit `344ae817f8a51c110544267d8da12d9e83ebfdfa`: Windows,
pruebas nativas y Docker aprobados. Se aprobaron 565 pruebas nativas y
el recorrido adicional de interfaz recuperada (566 de aplicación).
Evidencia y límites: `docs/qa/PHASE_9_RECOVERED_HTTP_UI.md`.
Es una prueba de recuperación local/test y no demuestra recuperación
del frontend productivo, DNS/TLS, otro host, custodia de secretos ni RPO/RTO.
