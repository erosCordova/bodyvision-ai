# F3/F9 — Exportación acotada de auditoría y verificación local

Implementación: 22-11-2026 (Lima). Rama de integración:
`feature/phase3-auth-security`. Datos ficticios en local/test.

## Comportamiento y alcance

Administración permite descargar un JSON con toda la cadena de auditoría de
la organización autenticada, aunque la tabla solo presente treinta eventos.
El servidor obtiene el alcance de la sesión viva y exige rol administrador;
el cliente no selecciona otra organización. Miembros, especialistas y el
responsable de privacidad no pueden exportarla. Se conservan la renovación
compartida de JWT y la cancelación al cambiar de autenticación.

El archivo contiene UUID, secuencias, acciones, tipos de recurso, resultados
y fechas del registro de seguridad. No incorpora nombres, correos, contraseñas,
credenciales ni contenidos de expedientes. Los payloads son las cadenas UTF-8
exactas que PostgreSQL utilizó al calcular cada hash; no se reconstruyen con
otro serializador JSON.

La función SQL bloquea la cabecera de la organización, valida cada evento y
compara el resultado con dicha cabecera antes de generar el archivo. Una
escritura concurrente espera el mismo bloqueo. El máximo es **10.000 eventos
y 8 MiB**; si se excede cualquiera, se rechaza el archivo entero con 413.
Una cadena dañada devuelve 409. Ambos casos registran un fallo de exportación.
El evento `audit.export_generated` se añade después del corte y aparecerá en
la siguiente descarga. Describe generación, sin afirmar guardado final en disco.
Un fallo transaccional al registrar el evento impide entregar el archivo.

La API vuelve a validar independientemente el bundle antes del commit y
devuelve el SHA-256 de los bytes entregados. El navegador limita también la
lectura cuando falta Content-Length; verifica estructura, organización,
secuencias, encadenamiento, hash final, identificador y digest de transporte
antes de iniciar la descarga. Una respuesta tardía de otra sesión no puede
iniciar una descarga ni publicar su resultado.

## Comprobación del archivo guardado

El selector de archivo verifica el JSON dentro del navegador, sin subirlo al
servidor. La interfaz conserva durante la sesión del componente el digest y
la cabecera de la descarga reciente. Si se selecciona su mismo nombre, exige
además coincidencia de todos los bytes, incluida la metadata del bundle.
La referencia puede consultarse para conservarla por separado.

Los hashes acreditan coherencia interna, **no autoría ni anclaje externo**.
Quien reescriba una cadena completa y su checkpoint puede crear otro archivo
internamente coherente; la verificación aislada no demuestra ausencia de ese
truncamiento. El verificador Python acepta un `AuditCheckpoint` independiente
para detectar ese caso y tiene una regresión explícita. No se implementa una
autoridad de sellado, firma externa o aceptación legal de auditoría.

## Migración y privilegios

`0031_private_audit_export` añade una única función SECURITY DEFINER con
search_path explícito y ejecución reservada a `bodyvision_auth_app`.
`bodyvision_app` y PUBLIC no pueden ejecutarla; no se conceden lecturas de
tablas de seguridad. La API exige la revisión 0031. El downgrade elimina la
función y restaura el estado 0030 sin borrar registros de auditoría.

## Verificación local

- PostgreSQL 16 descartable: **33 pruebas aprobadas**, incluidos los ocho
  escenarios nuevos de integración, once verificaciones unitarias del bundle
  y catorce regresiones previas de privacidad. Se probaron ambos límites con
  volúmenes reales, daño de bytes/cabecera, concurrencia, aislamiento,
  privilegios y reversión a 0029/reaplicación al head.
- **354 pruebas frontend aprobadas** en la revisión final; TypeScript,
  ESLint y build aprobados tras la corrección de renovación. Las diecinueve
  nuevas verifican transporte acotado, alteración, cancelación
  y selección local de archivos sin llamadas de red.
- Bundle y revisión de salud: treinta pruebas unitarias en otra ejecución
  local, incluyendo las once del bundle ya contadas arriba.
  Ruff y `git diff --check` aprobados.
- El Chromium local continúa bloqueado por la restricción de sockets del
  entorno. La aceptación nueva de navegador se ejecutó en GitHub Actions
  con descarga real, comprobación independiente Node y archivo modificado.
  Otro recorrido cookie fuerza una rotación real del JWT antes de exportar y
  exige una sola renovación y una sola descarga; el componente conserva la
  operación al rotar el token de la misma identidad y la cancela al cambiarla.

## Estimación global

Se mantiene **92,5 % / 93 % visible**. Este entregable no aprueba los gates
externos de identidad, custodia de secretos, auditoría anclada, hardware,
privacidad o recepción formal. No modifica `main` ni aplica una migración
a una base alojada. El proveedor acordado para esa base sigue siendo Neon.


## Aceptación e integración — 22-11-2026 (Lima)

El [PR #60](https://github.com/erosCordova/bodyvision-ai/pull/60) se integró en
`feature/phase3-auth-security`, commit
`913b68dcd7656154cef19c330ecdce704bb64d35`.
La [CI integral #45094577949](https://github.com/erosCordova/bodyvision-ai/actions/runs/45094577949)
aprobó el head funcional `1e8bec7cf72a9eaf543af1a74270ea967a86338a`:
**472 backend + 354 frontend + 44 navegador público + 14 privado + 5 cookie +
1 privacidad/MFA = 890 pruebas de aplicación**. No se suman las repeticiones
Docker ni las comprobaciones independientes de retención. `native-checks`,
`windows-scripts` y `docker-smoke` terminaron en `success`. PostgreSQL 15,
migraciones, compilación y controles de calidad aprobaron.
La [retención independiente #45094577929](https://github.com/erosCordova/bodyvision-ai/actions/runs/45094577929)
aprobó el mismo head.

Chromium confirmó un archivo real con más de treinta eventos, cada hash y
encadenamiento calculados independientemente con Node, digest de transporte,
organización y ausencia de correos/contraseñas. La selección local comprobó
la copia original y rechazó una copia con fecha modificada bajo su mismo
nombre. El nuevo recorrido cookie rotó una sesión real antes de exportar y
comprobó una sola renovación, una sola descarga y la referencia conservada.
La revisión corrigió la cancelación indebida por rotación del token: el efecto
ahora depende de identidad/organización. Salir o cambiar de identidad sigue
cancelando la operación; las regresiones de componente cubren ambos casos.

Queda cerrada esta aceptación técnica con datos ficticios. No se implementa
anclaje externo ni se certifica autoría. La valoración global permanece en
**92,5 % / 93 % mostrado** y no hubo despliegue ni migración alojada.
