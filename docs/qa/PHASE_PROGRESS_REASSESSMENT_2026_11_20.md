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
