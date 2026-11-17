# BODYVISION AI — Reporte de Fase 1

Fecha: 17 de noviembre de 2026 · Zona de presentación: America/Lima.

**Estado: implementación de fundación preparada; criterio de salida NO cerrado.** La ejecución nativa está verificada. Falta demostrar `docker compose up --build` desde cero en un host con Docker y ejecutar el navegador sin las restricciones del entorno. No se avanza a Fase 2.

## Resultado implementado

Monorepo con API FastAPI/Pydantic/SQLAlchemy, PostgreSQL 15, migración Alembic reversible, rol SQL de API sin permisos de escritura de esquema, React 18/TypeScript estricto/Vite, React Query, Router, contratos Zod y cliente API común. Interfaz es-PE azul profundo, Inter local, adaptable, con comprobaciones reales, carga, error y reintento; estado vacío explícito para módulos futuros.

Dockerfiles multi-stage fijados por digest, usuarios no root, Compose con DB → migración → readiness API → UI, publicación únicamente en loopback, red privada, credenciales aleatorias generadas por script y roles separados. Configuración validada, logs JSON sin URLs/cuerpos/credenciales, correlation UUID y documentación OpenAPI. CI creado para controles nativos y smoke Docker; no se ha ejecutado en GitHub.

Documentación de arquitectura, datos, API, UX, seguridad, borrador legal, operaciones, ADR y pendientes externos. No hay datos personales, expedientes de demostración que aparenten ser reales, fotos, modelo IA o activo 3D. Las categorías corporales e insignias se implementarán junto con sus datos de dominio; health checks son metadatos de infraestructura.

## Evidencia ejecutada

| Control real | Resultado |
|---|---|
| Instalación Python con lock y hashes (`uv pip sync`) | 56 paquetes instalados en venv de desarrollo; runtime y desarrollo separados en locks coherentes |
| Instalación frontend limpia (`npm ci`) | Exit 0, lockfile aplicado |
| Ruff lint y formato | Exit 0; 14 archivos Python con formato verificado |
| Backend `pytest -q` contra PostgreSQL 15.18 real | **19 aprobadas**, ninguna omitida en ejecución integrada |
| Alembic upgrade → downgrade base → upgrade | Exit 0 en los tres pasos; revisión final `0001_foundation` |
| Privilegios SQL | App puede leer revisión; UPDATE y CREATE TABLE rechazados por PostgreSQL |
| API Uvicorn + Vite iniciados realmente | Arranque y peticiones HTTP comprobados |
| Health mediante proxy frontend | `/live` 200 y `/ready` 200 con revisión consultada en SQL |
| Caída real de PostgreSQL | `/ready` 503 NOT_READY y `/live` 200 |
| ESLint y TypeScript estricto | Exit 0 |
| Frontend Vitest | **5 aprobadas** |
| Build Vite | Exit 0; JS 303.79 kB / gzip 94.76 kB; CSS 7.36 kB / gzip 2.18 kB |
| `npm audit` | 0 avisos conocidos tras actualización |
| `pip-audit` sobre runtime | 0 avisos conocidos |
| Docker Compose v2.40.3 `config --quiet` | Exit 0; valida configuración, no contenedores |
| Compose `up --build --wait` | Bloqueado: socket Docker no accesible, `operation not permitted` |
| Playwright, 3 escenarios | **Bloqueados antes de cargar la página**: Chromium aborta al crear socket Unix; no se consideran aprobados |
| Alternativa Chrome Headless Shell | Descarga fallida por archivo vacío/truncado; no usado como evidencia de UI |
| axe, contraste y navegación por teclado en navegador | Pendientes, pues el navegador no arrancó |
| GitHub Actions remoto | No ejecutado; no hay repositorio externo conectado |

Los 3 escenarios de navegador no pudieron evaluar la aplicación: el archivo de salida dice `3 failed` por fallo de arranque de Chromium, no demuestra errores funcionales ni demuestra ausencia de ellos. La matriz Safari/iOS, Firefox y Edge no se probó. Los análisis de dependencias son consultas de avisos conocidos, no una auditoría de seguridad completa.

Las salidas originales están en `docs/qa/evidence/`: pruebas, migraciones, HTTP smoke, caída de DB, lint, build, instalación y análisis de dependencias. La primera ejecución de pytest sin conexión configurada omitió 3 pruebas SQL; la ejecución integrada posterior las ejecutó y aprobó, y es la registrada en esta tabla.

## Comandos ejecutados

Se ejecutaron realmente: `uv venv`, `uv pip compile --generate-hashes`, `uv pip sync`, `npm install` y posteriormente `npm ci`; `ruff check`, `ruff format --check`, `pytest -q`; `initdb` y servidor PostgreSQL 15.18 nativo; `alembic upgrade head`, `alembic downgrade base`, `alembic current`; `uvicorn app.main:create_app --factory --no-access-log`, `npm run dev`; peticiones HTTP a API y proxy; `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, `npx playwright install chromium --only-shell`; `npm audit`, `pip-audit`; y Compose `config` y `up` con el resultado detallado arriba. Las URLs con credenciales se pasaron por entorno y no se incluyen en el reporte ni en logs.

## Decisiones y cambios

Se sigue el stack Python de la especificación adjunta más reciente. Se mantuvo React18; Router, Vite, Vitest, Zod y herramientas se actualizaron a versiones fijadas sin avisos conocidos en los análisis ejecutados. Se separaron dependencias runtime/dev y se alojaron fuentes Inter latinas localmente. Se corrigió el estado visual para no mostrar un servicio como disponible tras un reintento fallido.

Se aceptan por ADR los defaults de identidad propia, MFA profesional, tenencia compartida con RLS, storage privado S3-compatible, retención propuesta de 12 meses, borrado/difuminado y futuro GLB con licencia. Su implementación no se simula en F1. MinIO, MailHog y worker se incorporarán al existir sus consumidores en fases posteriores. Terraform/proveedor y observabilidad completa quedan pendientes de las decisiones operativas.

## Riesgos y límites

- El recorrido Docker desde un README no puede declararse validado hasta construir y levantar sus contenedores. El CI contiene ese recorrido, pero no reemplaza evidencia de su ejecución.
- `APP_ENV=staging` y `production` se rechazan por completo. El gate granular R11 y sus controles detallados siguen pendientes de F3; el bloqueo preventivo actual tiene pruebas.
- Identidad, RBAC, RLS de tablas de negocio, consentimientos y auditoría sensible aún no existen. No se admiten datos reales ni pilotos.
- TLS, cifrado de volúmenes/backups, restauración, escaneo de imágenes, carga, revisión externa y despliegue todavía no están implementados/verificados.
- Textos legales en borrador, sin aprobación ni afirmación de cumplimiento. Activos 3D y modelos IA no se han integrado ni licenciado.
- Advertencia no bloqueante de Starlette: el adaptador de pruebas avisa de futura migración de httpx a httpx2. Las 19 pruebas pasan con versiones fijadas.
- La ruta de Swagger nativa y OpenAPI están configuradas; la interacción de Swagger en navegador no fue verificada; sus recursos CDN son bloqueados por la CSP estricta de nginx. La ruta Docker ofrece OpenAPI JSON; autoalojar Swagger o comprobarlo por ruta nativa antes de cerrar el contrato de documentación.

## Pendiente para cerrar F1

1. En un host Docker, seguir README desde una carpeta nueva: generar .env, `docker compose up --build --wait`, revisar salud y ejecutar tests de contenedores.
2. Ejecutar los 3 escenarios Playwright y axe con Chromium operativo contra el entorno; revisar también la pantalla de escritorio y móvil.
3. Ejecutar el workflow remoto y conservar evidencia. Corregir cualquier fallo detectado antes de continuar.

No se ha firmado aceptación de F1 ni iniciado F2.

## Archivos creados

El manifiesto `docs/qa/FILES_CREATED.txt` enumera todos los archivos fuente, configuración, documentación y evidencia incluidos. Se excluyen dependencias descargadas, entornos virtuales, compilados, secretos locales y resultados temporales del navegador. El paquete incluye código completo por archivo; los directorios `.gitkeep` reservan módulos futuros sin declarar implementación.
