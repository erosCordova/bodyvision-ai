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
