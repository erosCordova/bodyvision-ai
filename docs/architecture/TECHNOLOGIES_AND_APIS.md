# Tecnologías y APIs de BodyVision AI

Inventario del código de main (24/11/2026), basado en frontend/package.json, backend/pyproject.toml, infra/demo/Dockerfile, frontend/scripts/prepare_pose_assets.mjs, frontend/src/features/viewer/atlasSource.ts y las rutas de backend/app/api. No constituye certificación de funcionamiento clínico ni de aceptación completa.

## Stack

| Área | Tecnología | Uso |
|---|---|---|
| Frontend | React 18.3.1, TypeScript 5.9.3, Vite 8.3.8, HTML/CSS | Interfaz y compilación |
| Estado y navegación | TanStack Query 5, React Router 7 | Consultas y rutas |
| Formularios | React Hook Form 7, Zod 4 | Validación y entrada de datos |
| Gráficos | Recharts 3 | Evolución e indicadores |
| Visor | Three.js 0.187.0, WebGL, GLSL, GLTFLoader, DRACOLoader, OrbitControls | Atlas, capas, animación y simulaciones |
| IA | MediaPipe Tasks Vision 0.10.32, Pose Landmarker Lite, WebAssembly | Hasta 33 puntos corporales; inferencia local |
| Backend | Python 3.12 en contenedor alojado, FastAPI, Uvicorn, Pydantic | API REST y validación |
| Persistencia | PostgreSQL, SQLAlchemy, Psycopg, Alembic | Consultas, historial, migraciones |
| Seguridad | Cryptography/Fernet, Argon2 (identidad privada), PBKDF2 (sandbox), RLS | Protección de datos y aislamiento |
| Infraestructura | Docker, GitHub, Render, Neon | Ejecución, versiones y alojamiento |
| QA | Pytest, Vitest, Playwright, axe-core, ESLint, Ruff, GitHub Actions | Pruebas y controles |

## Arquitectura

Navegador → React/TypeScript → HTTPS API REST FastAPI → PostgreSQL en Neon (en entorno alojado). MediaPipe y Three.js se ejecutan en el navegador. PostgreSQL en Docker corresponde al desarrollo local y CI. La demo pública es de solo lectura; el sandbox autenticado usa una rama Neon aislada. No se habilitan datos reales.

## API REST propia

Prefijo /api/v1. Los métodos disponibles dependen del entorno y la autorización.

| Método y ruta relativa | Función |
|---|---|
| POST /auth/register | Registro sintético alojado |
| POST /auth/login | Inicio de sesión |
| POST /auth/logout | Revocación de sesión |
| POST /auth/activity | Actividad de sesión |
| GET /workspaces | Organización autorizada |
| GET /profiles | Listar expedientes |
| POST /profiles | Crear expediente |
| GET /profiles/{id} | Consultar ficha |
| PATCH /profiles/{id} | Editar ficha |
| POST /profiles/{id}/archive | Archivar expediente |
| GET /metrics/catalog | Catálogo de mediciones |
| GET, POST /profiles/{id}/measurements | Historial y registro |
| PATCH /measurements/{id} | Corrección de medición |
| GET /measurements/{id}/versions | Versiones |
| GET, POST /profiles/{id}/captures | Consultar y guardar imágenes |
| GET, DELETE /profiles/{id}/captures/{capture_id} | Recuperar y eliminar imagen |
| GET /profiles/{id}/analytics/derived | Cálculos derivados |
| GET /profiles/{id}/analytics/series | Serie temporal |
| GET /dashboard/summary | Indicadores |
| GET /health/live | Disponibilidad del proceso |
| GET /health/ready | Disponibilidad de PostgreSQL |

Las rutas de reportes de servidor, procesamiento de pose en servidor, escenarios versionados, MFA, consentimiento, auditoría privada y derechos del titular existen con restricciones; no se afirma que todas estén habilitadas en el sandbox.

## APIs del navegador y recursos externos

MediaDevices/getUserMedia para cámara, Canvas para preparación de imágenes, WebGL para renderizado, Fetch para HTTP y Web Crypto para identificadores. MediaPipe es una biblioteca con modelo preentrenado, no una API generativa remota. Los archivos del SDK y modelo se descargan en compilación desde jsDelivr y Google Cloud Storage con verificación SHA-256. El atlas utiliza el repositorio https://github.com/SeemaBansal1/3d-human-body-anatomy fijado a una revisión concreta en atlasSource.ts. La procedencia y licencia deben verificarse antes de uso de producción.

## Límites

No se utiliza ChatGPT, Gemini ni Claude como motor de análisis corporal. No se ha entrenado una red neuronal propia. La grasa corporal observada procede de mediciones instrumentales registradas, no de fotografías; las capas térmicas ilustrativas y deformaciones gráficas no son reconstrucciones clínicas. El almacenamiento alojado de imágenes es temporal y exclusivo para datos ficticios. La deformación automática del atlas según mediciones del expediente sigue pendiente. El registro alojado no verifica el correo; no sustituye la identidad privada de producción.

Fuentes del repositorio: [frontend](../../frontend/package.json), [backend](../../backend/pyproject.toml), [API](../../backend/app/main.py), [atlas](../../frontend/src/features/viewer/atlasSource.ts), [MediaPipe](../../frontend/scripts/prepare_pose_assets.mjs), [sandbox](../operations/HOSTED_SYNTHETIC_SANDBOX.md), [archivo de imágenes](../operations/SANDBOX_IMAGE_LIBRARY.md).
