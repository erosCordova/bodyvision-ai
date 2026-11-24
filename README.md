# BODYVISION AI — Plataforma de análisis corporal 3D

## Aplicación web y arquitectura tecnológica

- [Entorno de pruebas con registro e inicio de sesión](https://bodyvision-ai-pruebas.onrender.com/access): expedientes ficticios aislados, mediciones editables, imágenes temporales cifradas y análisis local de pose.
- [Demostración pública de solo lectura](https://bodyvision-ai-interfaz.onrender.com).
- [Tecnologías y APIs implementadas](docs/architecture/TECHNOLOGIES_AND_APIS.md).

El registro alojado es exclusivamente sintético, sin verificación de propiedad del correo ni habilitación clínica. Las funciones privadas local/test mantienen sus propios controles. No se autoriza el uso de datos reales.

## Desarrollo privado y local

La rama de identidad añade administración de cuentas, consentimientos, permisos,
cambio de contraseña propia, cierre de sesiones y auditoría encadenada verificable.
Es una modalidad optativa de desarrollo/CI, distinta de la demostración pública.
Su configuración y límites están en [fundación de identidad F3](docs/phase3_identity_foundation.md).
La modalidad privada local/test no admite cuentas públicas ni datos reales. El responsable ficticio
de privacidad gestiona solicitudes y revocación de consentimientos con MFA y
permisos explícitos, sin acceso clínico. Su alcance está en
[privacidad y mínimo dato](docs/qa/PHASE_3_PRIVACY_OFFICER.md). MFA TOTP y recuperación
existen bajo activación privada local/test; no están habilitados por la receta
Docker de abajo.

Núcleo local para registrar expedientes y mediciones **ficticias**, conservar correcciones y consultar evolución. **No es un dispositivo médico.** La modalidad privada de identidad y consentimiento es optativa; el uso con datos reales sigue bloqueado. El backend es Python/FastAPI según la especificación adjunta.

La interfaz abre el resumen; puedes crear un expediente desde **Expedientes**. Para cargar ejemplos explícitos, después del arranque ejecuta:

```bash
docker compose run --rm seed
```

Se crean 5 expedientes por cada organización ficticia con mediciones de seis meses, huecos, un atípico y una corrección. Repetir no duplica. El selector de organización es para desarrollo local; no autentica a nadie.

## Requisitos

Docker Engine con Docker Compose v2 (`--wait` requiere v2.20+), Python 3.11+ para generar configuración y comprobar el arranque, Git opcional, 4 GB de RAM libres y acceso a los registros de imágenes/paquetes. En Windows: Docker Desktop iniciado con contenedores Linux y Git Bash. No necesita Node ni PostgreSQL instalados para la ruta Docker. Puerto local 8080 libre.

## Reinicio en Windows con doble clic (instalacion ya realizada)

En la carpeta de este checkout abre `INICIAR_BODYVISION.cmd` con doble clic.
Requiere que Docker Desktop este abierto en modo contenedores Linux, que exista
el archivo `.env` creado en la primera instalacion y que Python este disponible.
El iniciador **no crea una base nueva, no carga ejemplos, no cambia claves y no
ejecuta `docker compose down -v`**. Inicia los servicios existentes, valida
API/PostgreSQL/interfaz y, solo si todo pasa, abre
`http://localhost:8080`. Si falla, deja el error visible. No se considera
prueba de navegacion, identidad privada o recepcion operativa.

Si clonaste esta rama antes de que se agregara el archivo, actualiza **esa
misma carpeta** desde Git Bash (sin borrar `.env` ni crear un segundo clon):

```bash
cd "$HOME/RUTA_REAL_DE_TU_CARPETA_BODYVISION"
git status --short
git pull --ff-only
```

Sustituye la ruta por la de tu carpeta real. Si `git pull --ff-only` falla
o ves cambios propios en `git status`, conserva todo y revisa antes de
modificarlo; nunca uses `git reset --hard` para forzar la actualizacion.
El iniciador se conserva en `main`; actualiza únicamente la rama de tu instalación.
Este proceso no se conecta a Neon ni habilita usuarios reales.

## Inicio desde cero (Git Bash, macOS o Linux)

Desde esta carpeta:

```bash
python scripts/setup_local.py
docker compose up --build --wait
python scripts/check_local_installation.py
```

En sistemas donde el comando sea `python3`, úsalo en lugar de `python`. La primera orden genera `.env` con dos contraseñas aleatorias sin mostrarlas. La segunda inicia PostgreSQL, ejecuta Alembic como servicio de una sola ejecución, espera readiness de la API y publica la interfaz únicamente en loopback. La tercera verifica por HTTP la API, conexión/esquema SQL e interfaz; devuelve un código distinto de cero si falta un servicio. No modifica datos ni muestra respuestas o credenciales. Puede usarse `--json` para automatización. Consulta el [alcance del comprobador](docs/operations/LOCAL_STARTUP_VERIFICATION.md).

Abre http://localhost:8080. El resumen debe cargar desde la base. Las comprobaciones de salud están en /system. `http://localhost:8080/api/v1/health/live` comprueba el proceso; `/api/v1/health/ready` consulta PostgreSQL y exige la revisión declarada en `backend/app/db/session.py` para este checkout (actualmente `0032_privacy_rejection` en local/test; `0002_data_core` solo en demo). Swagger local: http://localhost:8080/api/v1/docs. La CSP local de nginx impide recursos externos de Swagger; para documentación interactiva usa el acceso nativo de desarrollo indicado abajo o el OpenAPI JSON `/api/v1/openapi.json`.

```bash
docker compose ps
docker compose run --rm api-test
docker compose run --rm frontend-test
docker compose --profile test stop db-test
docker compose logs --tail=100
docker compose down
```

Las pruebas Docker usan `db-test` y una red interna separada; no ejecutan migraciones ni limpiezas sobre la base de la aplicación. Su almacenamiento temporal se descarta al detener `db-test`. Consulta [aislamiento y verificación de conservación](docs/operations/LOCAL_TEST_DATABASE_ISOLATION.md).

`down` conserva los datos. **No uses `down -v` salvo que quieras destruir la base local.** Esta receta local no habilita registro público. Las cuentas ficticias de las pruebas privadas se preparan solo en CI descartable; esta receta no abre el login privado.

## Desarrollo nativo (alternativa)

Requiere Node.js 22.12+ y npm para la interfaz, y PostgreSQL **15** iniciado y un usuario propietario para migraciones, además de un rol `bodyvision_app` sin superusuario/CREATEDB/CREATEROLE/BYPASSRLS. `infra/postgres/init.sh` muestra la inicialización exacta. No reemplazar PostgreSQL por SQLite: las pruebas requieren el motor real.

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
python -m pip install --require-hashes -r requirements-dev.lock
export DATABASE_URL='postgresql+psycopg://bodyvision_app:CLAVE_LOCAL@127.0.0.1:5432/bodyvision'
export MIGRATION_DATABASE_URL='postgresql+psycopg://PROPIETARIO:CLAVE_LOCAL@127.0.0.1:5432/bodyvision'
alembic upgrade head
uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --no-access-log
```

En Git Bash de Windows activa `.venv/Scripts/activate`. Sustituye las URLs por credenciales locales; no las compartas ni las guardes en el repositorio. En otra terminal:

```bash
cd frontend
npm ci
npm run dev
```

Abre http://127.0.0.1:5173. Vite redirige `/api` a la API local. Para Swagger nativo: http://127.0.0.1:8000/api/v1/docs (usa CDN externo únicamente para recursos de documentación; no contiene datos de personas).

## Controles nativos

```bash
cd backend
source .venv/bin/activate
ruff check app tests alembic
ruff format --check app tests alembic
export TEST_DATABASE_URL='postgresql+psycopg://PROPIETARIO:CLAVE_LOCAL@127.0.0.1:5432/bodyvision_test'
MIGRATION_DATABASE_URL="$TEST_DATABASE_URL" alembic upgrade head
pytest -q
MIGRATION_DATABASE_URL="$TEST_DATABASE_URL" alembic downgrade base
MIGRATION_DATABASE_URL="$TEST_DATABASE_URL" alembic upgrade head
```

Crea previamente `bodyvision_test` como base descartable, con los roles y permisos de inicialización indicados arriba. Nunca apuntes `TEST_DATABASE_URL` a la base de la aplicación ni a Neon: los tests y el downgrade eliminan datos. La ruta Docker prepara y aísla automáticamente su propia base de pruebas.

```bash
cd frontend
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

E2E requiere API y Vite activos y base migrada. Para probar Docker usa `E2E_BASE_URL=http://127.0.0.1:8080 npm run test:e2e`. `CHROMIUM_PATH` permite un navegador ya instalado.

## Estructura y límites

- `backend/`: FastAPI factory, configuración validada, logs JSON sin URLs/cuerpos, health checks y Alembic.
- `frontend/`: React 18, TypeScript estricto, cliente único validado con Zod, React Query, Router, tokens CSS, pruebas unitarias/E2E/axe.
- `infra/`: inicialización de rol SQL y configuración de despliegue. La base alojada utiliza **Neon**; PostgreSQL en Docker es exclusivamente local/CI. No provisionar bases en Render. La separación productiva de entornos e IaC sigue pendiente de F9.
- `docs/`: decisiones, contratos, privacidad, operaciones y evidencia.
- `.github/workflows/ci.yml`: instalación bloqueada, lint, tests, migraciones, build, E2E y smoke Docker en un runner compatible.

`APP_ENV=production` y `staging` están bloqueados por completo. Este bloqueo preventivo no sustituye el gate granular R11 de F3. La rama de desarrollo incluye visor 3D, simulación y análisis local de pose. En modo privado local/test también permite guardar resúmenes mínimos ficticios de pose y consultarlos desde Resultados de pose del expediente, con doble aceptación y auditoría; no conserva fotos ni coordenadas en esos resúmenes. Sus pruebas y pendientes se consultan en `/progress` y `docs/qa/PHASE_5_PRIVATE_POSE_SUMMARIES.md`. Las observaciones ficticias no se presentan como datos de personas reales.

Estado de la entrega actual: [reporte F2](docs/qa/PHASE_2_REPORT.md). Evidencia previa: [reporte F1](docs/qa/PHASE_1_REPORT.md). **La Fase 1 fue comprobada con Docker y navegador en [GitHub Actions](https://github.com/erosCordova/bodyvision-ai/actions/runs/44110966237). El reporte conserva el alcance y las limitaciones de esa evidencia.**
