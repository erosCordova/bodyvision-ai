# Interfaz privada y HTTP real sobre PostgreSQL recuperado

## Alcance

El ensayo extiende la restauración y aceptación MFA existentes. Después
de verificar esquema, permisos, datos y factor, mantiene detenida la base
original y levanta API e interfaz en el espacio de red del PostgreSQL de
reemplazo. No se publican puertos ni se habilita salida de red.

| Componente | Ejecución y conexión |
|---|---|
| PostgreSQL 15 | Instancia nueva con `--network none` y datos temporales |
| API privada | Uvicorn en `127.0.0.1:8000`, MFA activo y roles LOGIN limitados |
| Interfaz privada | Vite DEV en `127.0.0.1:5174`, proxy HTTP a la API recuperada |
| Chromium | UID/GID del runner, entra solo en el espacio de red con `nsenter` |

La imagen de interfaz `recovery-web` reutiliza el build con activos
verificados. Sirve el código en desarrollo porque el acceso privado
está autorizado exclusivamente para local/test. La condición DEV que
deshabilita acceso privado en el build público de producción se conserva.
El frontend no recibe archivos de claves ni credenciales del servidor.

## Recorrido de navegador

1. Ingreso por el formulario con contraseña y un código MFA nuevo.
2. Apertura del expediente restaurado y consulta de 70,25 kg desde la API.
3. Registro por formulario de una medición ficticia de 70,35 kg.
4. Cierre de sesión y denegación HTTP del token revocado.
5. Nuevo ingreso con otro código y consulta de la escritura persistida.
6. Cuenta de otra organización sin expedientes autorizados ni acceso al objetivo.

No se interceptan solicitudes ni se reemplaza la API o PostgreSQL con
mocks. La comparación de filas se realiza antes de estas escrituras
sobre la instancia descartable. Los valores/fechas de prueba respetan
las validaciones existentes y el dato atípico ficticio del seed.

## Protección de evidencias

El navegador no registra trazas, vídeo ni screenshots. Su directorio
de salida, incluidos contextos de error automáticos, está dentro del
directorio privado temporal y fuera de los artefactos de CI. Un reporter
solo emite estados y nombres estáticos de etapas; omite errores, logs de
acciones, respuestas, tokens y datos introducidos en formularios.
La API monta el estado solo para lectura. Los contenedores y el estado
temporal se destruyen al terminar, también ante un fallo.

## Estado y límites

La comprobación complementaria local aprobó HTTP real mediante el proxy:
readiness, login MFA, consulta privada y logout. Los 146 tests unitarios
y las comprobaciones de tipos/lint aprobaron. El recorrido completo
aprobó en Chromium sobre PostgreSQL 15 en el job `docker-smoke` de
[CI 44942197913](https://github.com/erosCordova/bodyvision-ai/actions/runs/44942197913),
commit `344ae817f8a51c110544267d8da12d9e83ebfdfa`.
La ejecución integral terminó con **success** en Windows, pruebas nativas
y Docker. Aprobaron **565 pruebas de la batería nativa** (278 backend,
243 frontend, 36 navegador público y 8 privado) y **un recorrido adicional
de interfaz recuperada**: **566 pruebas de aplicación** en total, además
de los controles de scripts y restauración. El log confirma
`synthetic_recovered_browser_completed` con estado `passed`, seguido de
la recuperación saludable de la instalación original. El bloque de
reposición duró 40 segundos en ese runner; no es un RTO.

Este entregable se valora manualmente en **5 puntos de fase**: Fase 9
**85 % → 90 %**. La suma de diez fases pasa de 865 a 870 y la media
de **86,5 % a 87,0 %**; el porcentaje visible permanece en **87 %**
por redondeo. Las demás fases no cambian.

El alcance es la interfaz privada de desarrollo local/test sobre el
reemplazo. No certifica despliegue de frontend productivo, DNS/TLS,
recuperación de otro host, custodia de secretos, PITR, RPO/RTO ni
preparación clínica. No se modifica el modelo 3D ni la base alojada.
