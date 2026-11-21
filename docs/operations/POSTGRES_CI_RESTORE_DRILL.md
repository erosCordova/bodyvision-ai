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
mediante `verify_test_isolation.py`. No depende de que la base
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
