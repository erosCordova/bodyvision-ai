# F1 — pruebas Docker separadas de la base local

20 de noviembre de 2026 · America/Lima.

## Problema y cambio

Antes, `api-test` recibía `MIGRATION_DATABASE_URL` y dependía de la migración
de la aplicación. Por tanto ejecutaba pruebas, triggers temporales y limpiezas
sobre la misma base que el usuario veía en la interfaz. La suite privada contiene
limpiezas de auditoría; ningún test debe alcanzar datos de trabajo conservados.

Ahora el mismo comando `docker compose run --rm api-test` prepara una cadena
independiente: `db-test` → `migrate-test` → `api-test`.

| Propiedad | Aplicación | Pruebas Docker |
|---|---|---|
| Servicio PostgreSQL | `db` | `db-test` |
| Base | Configurada en `.env` | `bodyvision_test` fija |
| Almacenamiento | Volumen `postgres_data` conservado | tmpfs acotado a 512 MiB, sin volumen de datos |
| Red | `private` | `tests`, interna, sin salida externa |
| Migraciones | `migrate` | `migrate-test`, mismas revisiones en base distinta |
| Origen de URL de pruebas | No aplica | Generada con host `db-test`, nunca desde `MIGRATION_DATABASE_URL` |

La base de pruebas no publica puertos y no participa en la red de la API.
Las credenciales generadas por la preparación local se reutilizan solo para
arrancar este contenedor aislado; no se leen credenciales de Neon. La base
alojada del proyecto sigue en Neon. Este cambio no conecta ni migra bases alojadas.

## Operación

Las pruebas no requieren arrancar la API ni sembrar la base local: migraciones
y fixtures crean los datos ficticios necesarios en `db-test`. Sin perfil test,
el arranque habitual no crea la base de pruebas.

```bash
docker compose run --rm api-test
docker compose run --rm frontend-test
docker compose --profile test stop db-test
```

Al detener `db-test` se descarta su tmpfs. El siguiente arranque necesita aplicar
de nuevo las migraciones en ese servicio; Compose ejecuta `migrate-test` como
dependencia. `docker compose down` conserva `postgres_data` de la aplicación;
no usar `down -v` para limpiar pruebas en una instalación que se quiera conservar.

Una instalación anterior debe reconstruir la imagen si cambió el código:
`docker compose build api-test migrate-test`. No regenerar `.env` ni borrar su
volumen para adoptar el aislamiento. No ejecutar varias suites a la vez contra
el mismo `db-test`; usar proyectos Compose distintos para concurrencia.

Las pruebas nativas con `TEST_DATABASE_URL` siguen requiriendo una base realmente
descartable elegida por quien las ejecuta. El aislamiento aquí descrito pertenece
a la ruta Docker. La identidad privada tiene integración completa en el job
nativo; Docker mantiene los skips explícitos de esas pruebas sin `AUTH_DATABASE_URL`.

## Verificación de conservación

CI arranca y siembra la aplicación local, obtiene un `pg_dump --data-only` antes
y después de la suite Docker, y compara su contenido con SHA-256 mediante
`scripts/verify_test_isolation.py`. Se incluyen registros y estado de secuencias;
solo se ignoran las claves aleatorias de las líneas `\restrict` y `\unrestrict`
que añade pg_dump. Dumps vacíos o sin datos fallan la comprobación.

Los dumps temporales contienen exclusivamente fixtures sintéticos del runner,
no se imprimen ni se suben como artefactos. La salida del comprobador solo dice
si hubo cambios. Se vuelve a comprobar readiness e interfaz después de los tests.

Esto verifica conservación del contenido lógico de esa ejecución, no acredita
backups restaurados, aislamiento productivo, seguridad clínica ni aceptación humana.
La CI de esta PR debe completar ambos jobs antes de integrar el cambio. F1 mantiene
pendiente su recepción operativa; staging/producción y respaldo corresponden a F9.

El cambio aporta un control operativo que faltaba: separación de las pruebas y
conservación comprobada del trabajo local. Tras CI verde, la estimación técnica
de F1 pasa de 90 a 95 %. La suma de las diez fases pasa de 745 a 750; su media
redondeada sigue en 75 % global. No representa recepción formal ni cierre F1.
