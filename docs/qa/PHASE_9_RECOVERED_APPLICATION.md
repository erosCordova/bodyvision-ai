# Aceptación privada sobre PostgreSQL recuperado

## Alcance verificado

La [ejecución 44935709054](https://github.com/erosCordova/bodyvision-ai/actions/runs/44935709054),
commit `56e45426d4f080e5118764bd0fab91491f4fc49b`, aprobó
`docker-smoke`, incluida la aplicación privada sobre el PostgreSQL 15
recién restaurado. Durante esa comprobación, la base principal seguía
apagada y la instancia de reemplazo no tenía red externa ni acceso al
volumen de datos original. La ejecución integral terminó con **success**
en Windows, `native-checks` y `docker-smoke`. Aprobaron **557 pruebas
de aplicación**: 270 backend, 243 frontend, 36 navegador público y
8 privado, además de los controles de scripts y recuperación.

La comprobación anterior de equivalencia de filas y secuencias se mantiene
antes de habilitar credenciales y realizar escrituras sobre el reemplazo.
El respaldo ahora conserva permisos y revocaciones; los propietarios se
reasignan al administrador sintético del destino. Los dos roles LOGIN
no son propietarios ni superusuarios y no tienen BYPASSRLS.

| Control | Resultado exigido y observado en Docker |
|---|---|
| Autenticación de PostgreSQL | Conexión positiva por cada rol y contraseña incorrecta rechazada por SCRAM |
| Permisos SQL | Datos no leen hashes de contraseña; autenticación no lee ciphertext |
| RLS | Sin contexto no aparecen expedientes; una organización no ve la otra |
| API privada | Sin sesión, 401; sesión restaurada y nuevo login válidos; otra organización recibe 404 |
| Escritura | Nueva medición ficticia de 70,25 kg persistida y consultada con su ID y unidad |
| Archivo cifrado | PNG recuperado coincide byte por byte con el original ficticio |
| Clave ausente/incorrecta | 503/500 sin entrega de los bytes del PNG |
| Auditoría | Cadena SHA-256 restaurada verificada con eventos existentes y nuevos |
| Revocación | Logout de la sesión previa al respaldo y posterior denegación con 401 |

El estado privado de prueba guarda credenciales y clave fuera del dump,
en un directorio temporal de acceso restringido. Se elimina al finalizar,
también ante un fallo. No se publica como artefacto. Los mensajes de
error no imprimen respuestas privadas, SQL, claves, tokens ni DSN.

## Límites

El ensayo utiliza FastAPI TestClient y conexiones reales de PostgreSQL,
sin SET ROLE ni motores de propietario inyectados en la aplicación.
No es una prueba de frontend o HTTP por socket sobre el reemplazo.
La ampliación posterior por HTTP y navegador se registra por separado
en `PHASE_9_RECOVERED_HTTP_UI.md`.
Los 22 segundos del bloque de reposición de este runner no son un RTO.
El ensayo original de `56e4542` no incluía recuperación MFA;
la ampliación posterior aceptada consta en `PHASE_9_RECOVERED_MFA.md`.
No cubre custodia productiva de claves, PITR, copias externas ni
infraestructura fuera del host. No modifica Neon, despliegues o datos reales.

Las pruebas de restricciones del runner cubren opt-in, entorno/base/rol
permitidos, host loopback, redacción de excepciones y rechazo de hosts
externos. Con CI integral aprobada, este entregable se valora manualmente
en **5 puntos de fase**: Fase 9 **75 % → 80 %**. La suma de las diez
fases pasa de 855 a 860 y la media de **85,5 % a 86,0 %**: el tablero
permanece en **86 %** por redondeo. La puntuación no equivale a una
certificación operativa o de producción.
