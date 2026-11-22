# BODYVISION AI — Revisión del avance por evidencia (20-11-2026)

## Cambios de criterio registrados

Las cifras son **estimaciones manuales** del alcance técnico, ponderando las
10 fases del tablero 0–9 por igual. No equivalen a firmas, autorización para
personas reales, cumplimiento legal, ni exactitud médica.

| Fase | Antes | Después | Nueva evidencia incorporada |
|---|---:|---:|---|
| 3 · Seguridad e identidad | 75 % | 80 % | Alta de administrador **ficticio** mediante procedimiento local exclusivo: revisión de contraseña, rol único, auditoría encadenada; paso «Backend quality and migrations» aprobado en la ejecución nativa [44825096346](https://github.com/erosCordova/bodyvision-ai/actions/runs/44825096346) |
| 8 · Simulación | 80 % | 85 % | Modelo 3D compartido, comparación histórica, trazabilidad técnica, PNG, matriz de 960 combinaciones **sintéticas**, advertencia de saturación y pruebas integrales aprobadas [44823204295](https://github.com/erosCordova/bodyvision-ai/actions/runs/44823204295) |

No se ha cambiado ninguna de las demás fases. La suma sube **10 puntos
porcentuales de fase** (dos mejoras de 5); al dividir por diez, el promedio
pasa de 76,5 % a **77,5 %**, que el dashboard redondea a **78 %**.

## Criterios que permanecen sin cerrar

- **Fase 3:** la identidad legal del primer administrador real **no** está
  verificada; no existe recuperación externa de cuentas ni custodia/rotación
  aprobada de todas las claves. La API privada permanece restringida a
  local/test y sigue prohibido usar expedientes reales.
- **Fase 8:** no se ha contrastado la morfología sintética con escáneres o
  cohortes autorizadas ni con teléfonos físicos de referencia. Las
  simulaciones son ilustraciones, no predicciones médicas.
- Las fases 0 y 2 necesitan aceptación expresa de responsables humanos;
  ningún éxito de CI sustituye esas aprobaciones.

## Evidencia reproducible

El soporte técnico figura en
`backend/tests/integration/test_first_admin_bootstrap.py`,
`frontend/tests/morphologyMatrix.test.ts`,
`frontend/tests/morphLimits.test.ts`,
`frontend/tests/e2e/body-viewer.spec.ts` y sus documentos de QA
correspondientes. El gate nativo de `44825096346` aprobó las pruebas de
backend, aunque esa ejecución global no es «success» por un conflicto entre
la restricción loopback del alta y el hostname interno de Docker. El commit
posterior deja el alta sobre loopback y excluye esa prueba positiva del
contenedor; una ejecución CI integral nueva debe aprobarse para cerrar
la regresión final. No confundir ese hecho con una aprobación completa previa.

No se ha modificado `main`, la base alojada ni la demo pública.

## Incremento de identidad tras cierre de rotación MFA local

La Fase 3 se actualiza de **80 % a 85 %** tras la aceptación técnica
del procedimiento fuera de línea que recifra todas las semillas ficticias,
verifica la clave nueva y registra auditoría en una transacción PostgreSQL.
El commit de la implementación superó los jobs
`native-checks`, `windows-scripts` y `docker-smoke` en
[GitHub Actions 44827504437](https://github.com/erosCordova/bodyvision-ai/actions/runs/44827504437).
También se corrigió la documentación que antes decía que no había ningún
procedimiento de rotación.

El resto de fases no varía: el promedio pasa de **77,5 % a 78,0 %**, por lo
que el porcentaje **global visible continúa en 78 %**. No es un
certificado de seguridad, custodia de claves, aprobación clínica ni
autorización de usuarios reales. Se mantienen como gates pendientes la
identidad legal, recuperación asistida, respaldo/custodia externos y
pruebas de recuperación ante desastre.


## Fase 4: historial cifrado paginado, total correcto y revocación

La Fase 4 pasa de **70 % a 75 %** según la estimación manual de
alcance técnico (diez fases con igual ponderación). El archivo privado
cifrado ahora ofrece navegación paginada, total íntegro de capturas
ficticias no caducadas, respuesta HTTP no almacenable y regresiones de
autorización/consentimiento. La prueba con 57 filas sintéticas
(56 vigentes y 1 vencida) y la prueba de interfaz fueron aprobadas
en [GitHub Actions 44830333880](https://github.com/erosCordova/bodyvision-ai/actions/runs/44830333880).

Con +5 puntos para una sola de diez fases, el promedio global exacto
pasa de **78,0 % a 78,5 %**, mostrado como **79 %** por redondeo.
Este incremento *no* representa una prueba clínica ni la eliminación
irreversible de copias de seguridad, descargas, WAL o snapshots.
Permanece prohibida la subida de fotografías de personas reales.


## Fase 4: mantenimiento autónomo local de capturas vencidas

Con la ejecución integral [44833432116](https://github.com/erosCordova/bodyvision-ai/actions/runs/44833432116)
aprobada, la Fase 4 pasa de **75 % a 80 %**. Se comprobó que un
proceso separado y optativo limpia ciphertext vencido con PostgreSQL
activo, **aunque el backend esté detenido**; usa el rol de datos
`bodyvision_app`, bloques limitados y un contexto `synthetic-only`,
sin acceso a píxeles ni rutas HTTP. La ejecución también verifica que
no elimina la captura vigente y que la API vuelve a un estado saludable.

La media de las diez fases pasa de **78,5 % a 79,0 %**: el porcentaje
global visible **permanece en 79 %**. No corresponde ajustar otras fases.
Siguen pendientes las operaciones cuando Docker/la base estén apagados,
la custodia de copias y claves, el borrado de backups/WAL y todas las
aprobaciones para uso real o clínico.


## Fase 7: PDF de servidor y auditoría de exportaciones

La ejecución integral [44839078148](https://github.com/erosCordova/bodyvision-ai/actions/runs/44839078148)
aprobó Windows, `native-checks` y Docker sobre `b7f5867c2f5898cf6e1f30b1d0a69f95bc8ad3ee`.
El informe privado obtiene dos mediciones vigentes desde una única consulta,
valida organización, expediente, métrica y fechas y genera un PDF A4 con IDs
de fuentes y fecha de consulta. El identificador del informe corresponde al
evento `report.export` confirmado en la cadena de auditoría. El navegador
comprueba SHA-256 antes de iniciar la descarga; un fallo de auditoría impide
la entrega. Las 471 pruebas de aplicación incluyeron ese recorrido real.

La Fase 7 sube de **75 % a 80 %**. La suma de diez fases aumenta de 790 a 795;
el promedio exacto es **79,5 %**, redondeado a **80 %**. No se modifican las
otras fases. No implica firma digital, autenticidad externa, validación
clínica ni preparación de producción. Los recorridos privados con cuentas
compartidas se ejecutan secuencialmente tras observar un timeout de auditoría;
las pruebas concurrentes del backend se mantienen y el rendimiento concurrente
de producción sigue pendiente. Detalles en `PHASE_7_SERVER_COMPARISON_PDF.md`.


## Fase 9: diagnóstico administrativo y atención de avisos locales

Se incorporan dos entregables técnicos locales, cada uno evaluado manualmente
en cinco puntos de fase: (1) muestras autenticadas por organización, acotadas y
sin identificadores exportados, P95 y avisos; (2) diagnóstico de conexión/esquema
y retención con recuperación, panel de administración y procedimiento de atención.
La Fase 9 pasa de **35 % a 45 %** después de aprobar Windows, pruebas nativas y
Docker en [CI 44841638430](https://github.com/erosCordova/bodyvision-ai/actions/runs/44841638430),
commit `075a525a6e962042f4acc68eaf5ebbb9e944355a`. La ejecución aprobó 484 pruebas
de aplicación, incluida la consulta real desde Administración y cierre de sesión.

La suma de diez fases pasa de **795 a 805**: el promedio exacto es **80,5 %** y el
valor visible redondeado **81 %**. Las otras fases no cambian. Los avisos son
locales y manuales, la telemetría desaparece con el proceso y no observa una
API que no pueda responder. La observabilidad centralizada/externa, notificaciones,
seguridad, secretos, respaldos productivos y aceptación operativa siguen pendientes.
Detalles en `docs/qa/PHASE_9_PRIVATE_OPERATIONS.md` y
`docs/operations/PRIVATE_SERVICE_DIAGNOSTICS.md`. No se certifica producción.


## Fase 5: resúmenes mínimos de pose e historial por expediente

Se incorporan dos entregables técnicos, evaluados manualmente en cinco puntos
cada uno: (1) persistencia de resúmenes mínimos versionados y consulta paginada
desde el análisis o directamente desde el expediente; (2) doble aceptación,
permisos y auditoría transaccional, reintentos sin duplicar y borrado sin
recreación del mismo envío, incluida la purga por revocación o renovación.
La Fase 5 pasa de **65 % a 75 %** tras aprobar la ejecución integral
[44847175532](https://github.com/erosCordova/bodyvision-ai/actions/runs/44847175532),
commit `169f5dcb1d5305b547beea2fda82b42b991df4bf`.

Aprobaron Windows, Docker, migraciones reversibles y **512 pruebas de aplicación**:
226 backend, 242 frontend, 36 navegador público y 8 privado. El nuevo recorrido
privado ejecuta MediaPipe sobre un patrón ficticio sin persona, guarda el resumen
negativo, lo consulta tras navegar al expediente y lo elimina. Las mediciones
corporales siguen vacías. Los casos de API también cubren paginación, aislamiento,
caducidad, revocación, renovación y reversión de un fallo de auditoría.

La suma de diez fases pasa de **805 a 815**, con promedio exacto **81,5 %**,
redondeado a **82 %**. Las otras fases no cambian. El servidor conserva la
salida declarada por el navegador: no vuelve a inferir ni certifica su precisión.
No se guardan fotos, coordenadas o huellas de imagen en estos resúmenes.
La caducidad deniega acceso, pero la eliminación física periódica por caducidad,
la retención de auditoría/claves/copias, los datos reales, dispositivos físicos,
corpus independiente y evaluación clínica mantienen sus criterios pendientes.
Detalles en `docs/qa/PHASE_5_PRIVATE_POSE_SUMMARIES.md`.
Esta entrega no migra la base alojada en Neon ni publica cambios en la demo.


## Fase 5: retención física de resúmenes y aceptación específica de PostgreSQL

Se registran dos entregables técnicos adicionales, cada uno estimado manualmente
en cinco puntos de fase: (1) purga física limitada de resúmenes sintéticos cuando
caduca el consentimiento o desaparecen los registros de consentimiento, integrada
en el mantenimiento privado y el proceso independiente optativo; (2) pruebas de
aceptación reproducibles sobre PostgreSQL 15 que cubren vigencia, caducidad,
lápidas de idempotencia, lotes, rol de mantenimiento, rollback y migración adelante/atrás.

La ejecución específica
[44858285862](https://github.com/erosCordova/bodyvision-ai/actions/runs/44858285862)
ha terminado con estado **success**: 39 pruebas aprobadas, migración
`0021_pose_retention` aplicada y revertida/restaurada con éxito. Este resultado
**no** equivale a una CI integral aprobada: la suite Docker de
[44857430062](https://github.com/erosCordova/bodyvision-ai/actions/runs/44857430062)
falló por finalización del proceso con código 137; la validación completa
continúa pendiente y debe investigarse sin suponer que 137 demuestra OOM.

La Fase 5 pasa de **75 % a 85 %** como evaluación manual del alcance
sintético respaldado por dos entregables. Las demás fases no varían:
la suma aumenta de **815 a 825**, promedio exacto de **82,5 %**, redondeado
por el tablero a **83 %**. No es un certificado de calidad clínica, precisión
diagnóstica, control de respaldos/WAL ni autorización de personas reales.
Quedan pendientes corpus independiente, dispositivos físicos, revisión clínica
y seguridad/privacidad, operación y retención de copias. La base alojada y
la demo pública no se modifican.


## Fase 9: vigilancia de caída y recuperación desde un proceso independiente

Se incorpora un entregable funcional independiente, valorado manualmente en
**5 puntos de fase**: un vigilante de disponibilidad expresamente optativo
para local/test ficticio. No depende del proceso FastAPI, no recibe credenciales,
no recoge identificadores ni respuestas de la API y emite únicamente cambios de
estado de preparación. Si la API deja de responder se observa
`unreachable`; si se reinicia con PostgreSQL y esquema vigentes pasa a
`ready`. Se rechazan orígenes externos, redirecciones, intervalos fuera de
rango y entornos demo/producción.

En [CI 44861754261](https://github.com/erosCordova/bodyvision-ai/actions/runs/44861754261),
commit `ff21c135c27bb4f87a38abd5b260f86c31ddab83`,
pasaron **Windows, backend, frontend, navegadores y Docker**. El paso
`Watchdog detects API outage and recovery without backend process` detuvo
el backend, verificó la señal de indisponibilidad y validó su recuperación
tras reiniciarlo. La suite nativa aprobó 238 tests backend, 243 frontend,
36 de navegador público y 8 privado: **525 de aplicación**.

La Fase 9 pasa de **45 % a 50 %**. La suma de las diez fases sube de
**825 a 830** y la media exacta de **82,5 % a 83,0 %**; el porcentaje
global mostrado **permanece en 83 %** por redondeo. Es avance real
de fase, no certificación de producción ni garantía de disponibilidad.

Quedan pendientes vigilancia fuera del host, notificaciones externas,
histórico durable, producción multiinstancia, RPO/RTO, custodia de secretos
y respaldos productivos, aceptación operativa y evaluación legal/de seguridad.
El proceso depende de que Docker/el equipo local sigan encendidos. No se han
modificado `main`, Render, Vercel ni la base alojada.


## Fase 9: historial local persistente, acotado y verificado

Entrega operativa adicional valorada en **5 puntos de fase**: el vigilante
independiente y optativo guarda solamente estado técnico permitido y hora
UTC en un volumen local SQLite exclusivo, sin credenciales de PostgreSQL
ni datos clínicos. Se limita a **256 transiciones de los últimos siete días**.
Un nuevo proceso recupera el estado y no duplica el último incidente.
`--history` permite consultar el historial aunque la API no responda.

La [CI integral 44863258689](https://github.com/erosCordova/bodyvision-ai/actions/runs/44863258689)
del commit `20263b74dd5ce339078452b06f7d7f04e3599764`
terminó con **success** en Windows, native-checks y Docker. Se aprobaron
242 pruebas backend, 243 frontend, 36 navegador público y 8 privado:
**529 pruebas de aplicación**, además de la restauración, conservación
de volúmenes y aceptación real de caída, recuperación, lectura desde
otro contenedor y ausencia de duplicados de evento. El diario corrupto
produce fallo explícito y no se simula disponibilidad.

La Fase 9 pasa de **50 % a 55 %**. La suma de las diez fases pasa de
**830 a 835** y la media de **83,0 % a 83,5 %**, mostrada como **84 %**.
Este avance es una estimación técnica documentada, no una certificación
de disponibilidad ni una validación productiva.

**Sigue faltando:** monitor externo al host/Docker, avisos a terceros,
histórico centralizado y protegido para varios procesos, respuesta a
incidentes formalizada, respaldos productivos y recuperación RPO/RTO,
custodia y rotación de secretos, revisión legal/de privacidad y seguridad.
El diario local no es una copia de seguridad ni un registro clínico.
No se ha modificado `main`, Vercel, Render o la base alojada.


## Fase 9: reconstrucción acotada de incidentes observados

Se añade un entregable operativo valorado manualmente en **5 puntos de
fase**: a partir de las transiciones sintéticas del diario local SQLite,
el vigilante agrupa eventos `degraded` y `unreachable` consecutivos
como un único episodio. Solo una observación `ready` posterior cierra el
episodio. Si falta, su resultado es `recovery_not_observed` y el tiempo
permanece nulo; no se infiere que la caída continúe hoy.

El modo optativo `--incidents` requiere el mismo entorno local/test
`synthetic-only`. Devuelve JSON acotado, sin fotografías, URLs, usuarios,
tokens ni registros clínicos. El campo
`seconds_between_observations` **no es la duración real de caída**,
solo el tiempo entre la primera observación no preparada y la recuperación
observada. No se calculan uptime, MTTR ni SLA porque el diario no almacena
latidos periódicos y puede contener huecos/truncamiento.

La [CI integral 44865810489](https://github.com/erosCordova/bodyvision-ai/actions/runs/44865810489)
aprobó el commit `379c5cc642000bb15dd93245a263c8c98a940785`
en Windows, backend, frontend y Docker. La batería nativa aprobó
**249 backend, 243 frontend, 36 navegador público y 8 privado:
536 pruebas de aplicación**. Docker simuló caída y recuperación, accedió
al historial desde otro contenedor y verificó un único episodio cerrado,
sin suponer cifras de disponibilidad. Las pruebas específicas de retención
PostgreSQL también aprobaron.

La Fase 9 aumenta de **55 % a 60 %**; la suma de fases pasa de
**835 a 840**, con promedio exacto de **83,5 % a 84,0 %**. El valor
global visible **permanece en 84 %**, por redondeo. La puntuación
es técnica y manual, no una certificación.

Siguen faltando alertas fuera del host, observabilidad externa,
custodia del registro, monitoreo cuando Docker esté caído, ensayos
productivos de recuperación, RPO/RTO, seguridad y aprobación legal.
`main`, servicios alojados, el modelo 3D y los datos reales
no se han alterado.


## Fase 9: vigencia del último sondeo y detección de observaciones obsoletas

Se registra un nuevo entregable operativo local y sintético, valorado
manualmente en **5 puntos de fase**. El vigilante independiente conserva
en SQLite el estado y hora UTC de **cada comprobación**, incluso si no cambia
el estado del backend. Solo ocupa **una fila** en una tabla dedicada,
separada del historial acotado de transiciones y sin datos de personas,
secretos, URL ni cuerpos HTTP.

La nueva consulta optativa `--status` distingue
`never_observed`, `recent`, `stale` y `clock_inconsistent`.
El umbral de vigencia es tres veces el intervalo configurado más cinco
segundos. Una observación anterior no demuestra el estado actual de
la API: la salida indica expresamente que se trata de la última
observación local, no disponibilidad en vivo. Los relojes inconsistentes
no producen una edad positiva ficticia.

La [CI integral 44926525791](https://github.com/erosCordova/bodyvision-ai/actions/runs/44926525791)
terminó con **success** sobre el commit
`737d006b7d8681777d0d7ec49fa8e68380506fde`. Aprobaron Windows,
native-checks y docker-smoke, con 255 pruebas backend, 243 frontend,
36 de navegador público y 8 privado: **542 pruebas de aplicación**.
La aceptación Docker interrogó `--status` desde un contenedor distinto
tras la caída y recuperación simuladas, verificando la marca temporal
reciente y la ausencia de estimaciones de disponibilidad. Las pruebas
unitarias adelantaron el reloj artificialmente para verificar que
el estado pasa a `stale` sin nuevos sondeos.

La Fase 9 aumenta de **60 % a 65 %**; la suma de diez fases pasa
de **840 a 845**. La media exacta pasa de **84,0 % a 84,5 %**, que
el tablero redondea a **85 %**. Es una estimación técnica manual,
no certificación clínica, disponibilidad ni aprobación de producción.

**Pendientes:** supervisión fuera del host y Docker, notificaciones
externas, telemetría centralizada entre procesos, custodia/cifrado de
incidentes, respaldo y recuperación productivos, RPO/RTO, revisión
operativa y de privacidad, seguridad y autorización de datos reales.
No se modifica `main`, Render, Vercel, la base alojada ni el modelo 3D.


## Fase 9: control de integridad anterior a restauración de PostgreSQL

Se añade un entregable operativo sintético valorado manualmente en
**5 puntos de fase**: el simulacro de restauración genera un manifiesto
SHA-256, tamaño y formato de un respaldo PostgreSQL `pg_dump --format=custom`,
y exige su coincidencia **antes** de invocar `pg_restore`.
Rechaza una copia deliberadamente alterada y comprueba que el respaldo
original sí se restaura correctamente en `db-test`; a continuación
mantiene la comprobación de equivalencia lógica del contenido.

El comprobador es independiente de frameworks, se habilita solo con
`APP_ENV=test`, `CI=true` y opt-in `synthetic-only`, limita el tamaño,
rechaza enlaces simbólicos, sobreescritura del manifiesto, datos con
formato equivocado y JSON inesperado. No registra contenido, SQL o
secretos; tampoco publica los archivos de backup como artefactos.

En la [CI integral 44927716849](https://github.com/erosCordova/bodyvision-ai/actions/runs/44927716849),
commit `4f2d4e9b9dc0f36a1d84d8c316e6f5f79bbda7c5`,
aprobaron Windows, `native-checks` y `docker-smoke`.
La batería nativa aprobó 255 pruebas backend, 243 frontend,
36 navegador público y 8 privado (**542 pruebas de aplicación**);
las pruebas de scripts verificaron creación, manipulación, rechazo
y opt-in en Linux y Windows. Docker aprobó la restauración de
la copia verificada y el rechazo controlado de una copia corrupta.

La Fase 9 pasa de **65 % a 70 %**. La suma de diez fases
pasa de **845 a 850**: el promedio global exacto pasa de
**84,5 % a 85,0 %** y el porcentaje visible **permanece en 85 %**
por el redondeo anterior. Esto no acredita recuperación productiva,
cifrado ni protección ante un atacante que reemplace a la vez
archivo y manifiesto. No establece objetivos RPO/RTO, almacenamiento
externo de respaldo ni controles para datos reales.

Quedan pendientes copias y custodia productivas, ensayo de recuperación
operativa ante caída del host, restauraciones geográficas, notificaciones
externas, recuperación/rotación de secretos, legalidad y evaluación de
seguridad. `main`, Render, Vercel, la base alojada y el modelo 3D
permanecen sin cambios.


## Fase 9: recuperación desde una instancia PostgreSQL nueva y aislada

La CI de recuperación se amplió más allá del `pg_restore` sobre
una base nueva en el servidor de tests ya activo. El ensayo
**detiene la pila principal** (frontend, backend y PostgreSQL original)
y confirma que la base fuente no está en ejecución. Inicia un
segundo PostgreSQL 15 en un contenedor temporal, sin red,
con `tmpfs` vacío de 512 MiB, **sin montar volúmenes originales**.

Antes de importar el respaldo íntegro y verificado por SHA-256,
el destino recrea únicamente las identidades globales exigidas
por las políticas RLS como roles sintéticos sin login, sin
contraseñas ni privilegios elevados. Verifica ausencia inicial
de tablas y coincidencia de `SHOW TimeZone` para evitar
diferencias de serialización de `timestamptz`.
La comparación independiente comprueba el multiconjunto completo
de filas de cada tabla, incluidos duplicados, encabezados y
valores de secuencias, sin depender del orden físico del volcado.
Cualquier discrepancia rechaza el ensayo sin emitir valores
de los registros. La verificación estricta original de
preservación de la misma base continúa intacta.

Concluida la comparación, destruye el contenedor temporal,
reinicia la instalación sintética original y comprueba que
la aplicación vuelve a estar saludable. El ensayo de Docker
registró **18 segundos** en su ejecución sobre el runner
descartable: ese tiempo **no es un RTO medido ni garantizado**.
No hubo un segundo host físico ni almacenamiento externo.

La [CI integral 44931458692](https://github.com/erosCordova/bodyvision-ai/actions/runs/44931458692)
aprobó el commit `86cd17d727e291fb1525ed9ca20a22258dbb662c`.
Finalizaron con `success` Windows, `native-checks` y `docker-smoke`;
se aprobaron **255 tests backend, 243 frontend,
36 públicos y 8 privados, total 542**. La aceptación separada
de retención de postura también concluyó correctamente.
Las pruebas de scripts incluyen el comparador semántico
y validan cambios de filas, duplicados, columnas y secuencias.

La Fase 9 pasa de **70 % a 75 %** como estimación técnica manual.
La suma de diez fases pasa de **850 a 855**: la media exacta
sube de **85,0 % a 85,5 %**, mostrada como **86 %** por redondeo
en el tablero. La ejecución **no demuestra** recuperación por
pérdida de un host real, copias fuera del equipo, cifrado/custodia
de backups, operación con datos de personas, PITR ni un objetivo
RPO/RTO garantizado. Faltan seguridad productiva, privacidad,
aprobaciones y monitoreo externo. No se modificaron `main`,
Neon, Render, Vercel ni el visor 3D.

## Fase 9: aplicación privada operativa sobre la base recuperada

Se acredita un entregable técnico adicional de **5 puntos de fase**:
aceptación de la API privada sobre un PostgreSQL 15 nuevo y restaurado,
mientras la base principal sigue detenida. El backup conserva ACL y
revocaciones. Los roles de datos y autenticación acceden mediante LOGIN
reales separados, sin SET ROLE, superusuario ni BYPASSRLS.

Se comprobaron SCRAM y rechazo de contraseña errónea, permisos SQL,
RLS sin contexto y entre organizaciones, sesión anterior al respaldo y
login nuevo, escritura y consulta de una medición, cadena de auditoría,
PNG ficticio recuperado con clave externa, rechazo con clave ausente o
incorrecta, logout y revocación de la sesión restaurada. La comparación
exacta de datos sucede antes de estas escrituras en el destino.

La [CI integral 44935709054](https://github.com/erosCordova/bodyvision-ai/actions/runs/44935709054)
aprobó `56e45426d4f080e5118764bd0fab91491f4fc49b` en Windows,
`native-checks` y Docker: **557 pruebas de aplicación** (270 backend,
243 frontend, 36 navegador público y 8 privado), más los controles de
scripts y del ensayo. Detalles en `PHASE_9_RECOVERED_APPLICATION.md`.

La Fase 9 pasa de **75 % a 80 %**. La suma de diez fases pasa de
**855 a 860** y el promedio exacto de **85,5 % a 86,0 %**;
el porcentaje visible **permanece en 86 %** por redondeo.
La valoración es técnica y manual. La aceptación usa TestClient con
PostgreSQL real, sin HTTP por socket ni frontend sobre el reemplazo.
No cierra recuperación MFA, custodia productiva de secretos, copias
externas, pérdida física del host, PITR ni RPO/RTO. No modifica Neon,
despliegues, `main`, el modelo 3D o datos reales.

## Fase 9: recuperación MFA y reemplazo de factor después de restaurar

Se acredita un entregable técnico de **5 puntos de fase**: una cuenta
ficticia configurada con MFA antes del respaldo conserva su sesión
verificada y permite autenticación TOTP o por código de recuperación
sobre el PostgreSQL 15 restaurado, con la base original detenida.
Un código consumido antes del respaldo sigue rechazado; códigos nuevos
y TOTP aceptados no pueden reutilizarse. La clave MFA externa es distinta
de la de capturas; sin clave no inicia la configuración MFA y con una
clave incorrecta no se emite token. Ambos roles SQL tienen denegado el
acceso directo a semillas cifradas y verificadores.

También se comprueba el reemplazo del factor con contraseña y código
válido: semilla nueva, sesiones anteriores revocadas, nueva confirmación,
ocho códigos nuevos, rechazo de un código antiguo aún no usado y
auditoría válida. Se utiliza el reloj real y la ventana TOTP existente.

La [CI integral 44939248415](https://github.com/erosCordova/bodyvision-ai/actions/runs/44939248415)
aprobó `0eba8fd7ae21bcc20db08d1c2bfe0cb11e91a5f9` en Windows,
pruebas nativas y Docker: **562 pruebas de aplicación** (275 backend,
243 frontend, 36 navegador público y 8 privado), más controles de
scripts y restauración. Evidencia: `PHASE_9_RECOVERED_MFA.md`.

La Fase 9 pasa de **80 % a 85 %**. La suma de diez fases pasa de
**860 a 865**, promedio de **86,0 % a 86,5 %**; el tablero muestra
**87 %** por redondeo. Las otras fases no cambian. Es una valoración
técnica manual, no certificación de producción. Siguen pendientes
frontend/HTTP real sobre el reemplazo, custodia productiva de secretos,
copias externas, pérdida del host, PITR, RPO/RTO y revisiones independientes.

## Fase 9: interfaz privada y HTTP real sobre la instancia restaurada

Se acredita un entregable técnico de **5 puntos de fase**: la API y
la interfaz privada local/test operan sobre PostgreSQL 15 restaurado,
mientras la base original permanece detenida. Uvicorn y Vite comparten
el espacio de red aislado del reemplazo; Chromium entra con el UID/GID
del runner. No se publican puertos ni se habilita el acceso privado
en el build público de producción.

El recorrido usa HTTP real y formularios sin mocks: ingreso MFA,
consulta de una medición, escritura de otra, logout y rechazo del token
revocado, nuevo ingreso y consulta de la escritura persistida, y
aislamiento de otra organización. Evidencias privadas y contextos de
error quedan fuera de los artefactos publicados y se eliminan al terminar.

La [CI integral 44942197913](https://github.com/erosCordova/bodyvision-ai/actions/runs/44942197913)
aprobó `344ae817f8a51c110544267d8da12d9e83ebfdfa` en Windows,
pruebas nativas y Docker: **565 pruebas nativas** (278 backend,
243 frontend, 36 públicas y 8 privadas) y **un recorrido adicional
de recuperación**, total **566 de aplicación**, más controles de scripts.
Evidencia: `PHASE_9_RECOVERED_HTTP_UI.md`.

La Fase 9 pasa de **85 % a 90 %**; la suma de diez fases de
**865 a 870** y la media exacta de **86,5 % a 87,0 %**. El tablero
permanece en **87 %** por redondeo. No se modifica ninguna otra fase.
La valoración es técnica y manual. No cierra recuperación productiva
de frontend/DNS/TLS fuera del host, custodia de secretos, copias externas,
PITR, RPO/RTO ni revisiones independientes y recepción operativa real.


## Fase 6: aceptación técnica de rendimiento del visor (21-11-2026)

El atlas 3D seleccionado mantiene su modelo y arquitectura. El diagnóstico
incorpora métricas de CPU por capa (tiempo de carga, memoria geométrica,
mediana y P95 de envío WebGL). Se reducen renderizados redundantes, se
pospone la simplificación LOD de capas ocultas y se prueban dos perfiles
de Chromium móvil/escritorio emulados con el atlas original versionado.
Las pruebas también comprueban un único canvas, límites de píxeles,
conservación de geometrías y ausencia de escrituras de datos.

La [CI integral 44963510164](https://github.com/erosCordova/bodyvision-ai/actions/runs/44963510164)
aprobó el commit `20cd0f94687f879e89e2717db5394241aa8f4616` en
Windows, Docker, backend, frontend y navegadores. Se aprobaron 278
pruebas backend, 257 frontend, 40 públicas y 8 privadas (583 en total).
La [aceptación de retención 44963510115](https://github.com/erosCordova/bodyvision-ai/actions/runs/44963510115)
también aprobó. Véase `docs/qa/PHASE_6_PERFORMANCE_ACCEPTANCE_2026_11_21.md`.

El entregable de aceptación reproducible se valora manualmente en cinco
puntos de fase: **Fase 6: 85 % a 90 %**. Solo cambia esa fase; la suma
de diez fases pasa de 870 a 875, y la media exacta pasa de 87,0 % a
87,5 %, **88 % en el tablero** por redondeo.

No se ha validado rendimiento en teléfonos físicos, finalización GPU,
VRAM, FPS, consumo energético ni precisión morfológica o clínica.
Quedan pendientes referencias morfológicas autorizadas, pruebas reales,
revisión independiente de privacidad y aceptación humana. La base
alojada, los despliegues públicos y la rama principal no se modifican.


## Fase 8: aceptación técnica de simulación regional (21-11-2026)

El mismo modelo anatómico 3D conserva sus capas, el esqueleto, el simulador de
peso/estatura, la malla y el flujo de comparación. Se añade un inspector
reproducible del efecto de las fórmulas de GPU en cinco zonas de piel: 
variación lateral y frontal, valores positivos/negativos y saturación del
shader, sin presentarlos como mediciones reales de composición corporal.

La [CI integral 44964440107](https://github.com/erosCordova/bodyvision-ai/actions/runs/44964440107)
aprobó el commit `1a86016f1f3d70218869325b7223bf2ac155fe46`:
**278 pruebas backend, 262 frontend, 43 navegador público y 8 privado**
(591 pruebas de aplicación), más Windows, Docker, compilaciones, controles
de dependencias y recuperación con datos sintéticos. La 
[retención 44964440089](https://github.com/erosCordova/bodyvision-ai/actions/runs/44964440089)
también aprobó. Las nuevas pruebas verifican cambios reversibles,
invariancia del esqueleto frente al peso, y diez escenarios de peso/estatura
sin incrementar geometrías o texturas del mismo canvas.
Véase `docs/qa/PHASE_8_REGIONAL_SIMULATION_AUDIT_2026_11_21.md`.

La Fase 8 aumenta de **85 % a 90 %** en evaluación manual de su alcance
técnico. La suma de fases pasa de **875 a 880** y su promedio de
**87,5 % a 88,0 %**; el valor redondeado del tablero sigue siendo **88 %**.

No se ha validado precisión morfológica, predicción de cambios anatómicos,
rendimiento físico de GPU/VRAM, FPS o conformidad clínica. Se mantienen
pendientes referencias anatómicas autorizadas, pruebas en dispositivos físicos,
consentimiento y aprobación humana antes de uso real. No se alteraron
`main`, Neon ni los despliegues públicos.


## Fase 5: estabilidad de pose por reflejo y repetición (21-11-2026)

Se amplía la matriz de nueve variantes sintéticas del atlas 3D con un
indicador descriptivo de diferencias de puntos MediaPipe bajo reflejo
horizontal y una segunda inferencia sobre el mismo frontal. Los 33 índices
izquierda/derecha se emparejan correctamente, y se calculan cobertura,
mediana/P95 de distancias normalizadas solo con al menos ocho puntos comunes.
Los casos insuficientes devuelven valores nulos, y las muestras repetidas
requieren estabilidad de la decisión de detección. Los informes JSON de CI
contienen **solo agregados**, no fotografías ni coordenadas.

La [CI integral 44965518513](https://github.com/erosCordova/bodyvision-ai/actions/runs/44965518513)
aprobó el commit `337d0c8a99d890a5b4dc40d2ffe036c928e7497d`:
**278 pruebas de backend, 268 frontend, 43 públicas y 8 privadas**,
597 pruebas de aplicación en total; además aprobaron Docker, Windows y
compilaciones. La [retención 44965518523](https://github.com/erosCordova/bodyvision-ai/actions/runs/44965518523)
también terminó con `success`.
Documento: `docs/qa/PHASE_5_SYNTHETIC_MIRROR_REPEAT_2026_11_21.md`.

Se revisa manualmente **Fase 5 de 85 % a 90 %** porque el bloque de
estabilidad técnica reproducible tiene pruebas y criterios aprobados;
la suma de las diez fases pasa de **880 a 885**, con promedio de
**88,0 % a 88,5 %** y tablero redondeado de **88 % a 89 %**.

Se mantienen sin resolver validación sobre fotos autorizadas con
referencia humana independiente, rendimiento en hardware físico,
examen clínico y aprobación legal/privacidad para datos reales.
No se alteraron `main`, Neon ni los despliegues públicos.


## Fase 7: exportación longitudinal privada y auditada (21-11-2026)

Se incorpora en Expedientes → Evolución la descarga de CSV con las
observaciones vigentes del periodo seleccionado. El servidor obtiene
hasta 500 filas de PostgreSQL en una única consulta autorizada y registra
la generación en la cadena privada de auditoría antes de entregarla.
Los archivos contienen UUID de las fuentes, fechas UTC, valores y unidades,
método y indicador de registro atípico, no simulaciones, expedientes
de otra organización, imágenes o datos personales. Se rechazan fuentes
ausentes/inconsistentes y más de 500 observaciones, en vez de declarar
completa una exportación truncada. La interfaz comprueba la integridad
SHA-256 antes de iniciar la descarga.

El [CI integral 44967597848](https://github.com/erosCordova/bodyvision-ai/actions/runs/44967597848)
aprobó el commit \`3b94390acfd630937e150164973822d0b52e9a9c\`:
**291 pruebas backend, 270 frontend, 43 navegador público y 8 privado**,
612 pruebas de aplicación en total, además de Windows, Docker,
migraciones, restauración aislada y controles de retención.
La [retención independiente 44967597819](https://github.com/erosCordova/bodyvision-ai/actions/runs/44967597819)
también aprobó. Las pruebas nuevas abarcan la respuesta CSV desde
PostgreSQL, aislamiento, exactitud de IDs y Decimal, modificación
de fuentes vigentes, fallo cerrado de auditoría, digest y descarga
desde navegador privado.

Se registra el cumplimiento del bloque técnico de generación
longitudinal trazable y se reevalúa manualmente **Fase 7 del 80 % al 90 %**.
Las diez fases pasan de sumar **885 a 895 puntos**, por lo que el promedio
exacto pasa de **88,5 % a 89,5 %**, mostrado como **90 % por redondeo**.
El tablero no expresa un 90 % exacto ni una certificación de producto.

Quedan pendientes firma digital externa, persistencia probatoria del
archivo distribuido y recepción independiente, gestión de historiales
superiores a 500 observaciones, autorización para información personal
real, seguridad/privacidad y validación clínica. El evento de auditoría
solo acredita generación de informe y no distingue el formato, y el hash
transmitido en la misma respuesta no acredita la autoría de manera
independiente. No se modifican \`main\`, Neon ni despliegues públicos.
