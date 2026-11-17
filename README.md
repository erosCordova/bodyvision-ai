# BODYVISION AI — Fase 1

Base técnica local para registro, seguimiento y visualización corporal. **No es un dispositivo médico.** Esta entrega no acepta datos de personas ni incluye autenticación, expedientes, imágenes, IA o visor 3D. El texto adjunto `Texto pegado.txt` es la especificación de implementación; los dos PDF son referencias de diseño. El backend de esta especificación es Python, no Java.

## Requisitos

Docker Engine con Docker Compose v2 (`--wait` requiere v2.20+), Python 3.11+ solo para generar configuración, Git opcional, 4 GB de RAM libres y acceso a los registros de imágenes/paquetes. En Windows: Docker Desktop iniciado con contenedores Linux y Git Bash. No necesita Node ni PostgreSQL instalados para la ruta Docker. Puerto local 8080 libre.

## Inicio desde cero (Git Bash, macOS o Linux)

Desde esta carpeta:

```bash
python scripts/setup_local.py
docker compose up --build --wait
```

En sistemas donde el comando sea `python3`, úsalo en lugar de `python`. La primera orden genera `.env` con dos contraseñas aleatorias sin mostrarlas. La segunda inicia PostgreSQL, ejecuta Alembic como servicio de una sola ejecución, espera readiness de la API y publica la interfaz únicamente en loopback.

Abre http://localhost:8080. Las dos tarjetas deben informar conexión verificada. `http://localhost:8080/api/v1/health/live` comprueba el proceso; `/api/v1/health/ready` consulta PostgreSQL y exige la revisión `0001_foundation`. Swagger local: http://localhost:8080/api/v1/docs. La CSP local de nginx impide recursos externos de Swagger; para documentación interactiva usa el acceso nativo de desarrollo indicado abajo o el OpenAPI JSON `/api/v1/openapi.json`.

```bash
docker compose ps
docker compose run --rm api-test
docker compose run --rm frontend-test
docker compose logs --tail=100
docker compose down
```

`down` conserva los datos. **No uses `down -v` salvo que quieras destruir la base local.** No hay registro público ni usuario de prueba porque identidad corresponde a F3.

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
export TEST_DATABASE_URL="$MIGRATION_DATABASE_URL"
pytest -q
alembic downgrade base
alembic upgrade head
```

El downgrade es exclusivamente para la base descartable de F1. En fases siguientes se revisará su impacto sobre datos.

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
- `infra/`: inicialización de rol SQL. Proveedor y Terraform pendientes de F9; no hay despliegue productivo.
- `docs/`: decisiones, contratos, privacidad, operaciones y evidencia.
- `.github/workflows/ci.yml`: instalación bloqueada, lint, tests, migraciones, build, E2E y smoke Docker en un runner compatible.

`APP_ENV=production` y `staging` están bloqueados por completo. Este bloqueo preventivo no sustituye el gate granular R11 de F3. No se implementan botones de módulos futuros, métricas simuladas ni enlaces a políticas inexistentes.

Estado de aceptación y salidas reales: [reporte F1](docs/qa/PHASE_1_REPORT.md). **La Fase 1 fue comprobada con Docker y navegador en [GitHub Actions](https://github.com/erosCordova/bodyvision-ai/actions/runs/44110966237). El reporte conserva el alcance y las limitaciones de esa evidencia.**
