# Fase 3 — Access JWT y refresh rotatorio con detección de reutilización

Documento de subcomponente, alcance **local/test con datos ficticios**. No
registra aceptación de fase, uso productivo ni validación clínica. No modifica
los porcentajes de seguimiento.

## 1. Estado revisado antes de este cambio

Sobre `feature/phase3-auth-security` (`7d31641`) ya existían:

- Access JWT HS256 de 15 minutos como máximo, acotado además por la expiración
  de la sesión, con `iss`, `aud`, `jti` y validación estricta de cabecera y
  claims (`backend/app/core/access_tokens.py`).
- Verificación en cada petición contra la base: un JWT con firma válida solo se
  acepta si su `sid` resuelve una sesión viva, con rol y MFA vigentes
  (`backend/app/services/jwt_access.py`).
- Refresh en cookie `bv_private_refresh` `HttpOnly`, `SameSite=Strict`,
  `Path=/api/v1/auth/access`, con `Secure` cuando el esquema es https, más
  comprobación de `Origin` y `X-Requested-With`
  (`backend/app/services/cookie_access.py`).
- Rotación atómica de la sesión opaca, un solo uso por concurrencia, sin
  extender la expiración original y heredando `mfa_verified_at`
  (`backend/alembic/versions/0024_atomic_session_rotation.py`).
- Todo el conjunto es opt-in (`identity_enabled` + `jwt_access_enabled`) y
  `core/config.py` rechaza `staging`/`production`.

Brecha real: **no había linaje de sesiones**. Reproducir un refresh ya
consumido devolvía un 401 genérico, el token sucesor seguía siendo válido y no
se registraba auditoría. El contrato F1 pide detección de reutilización que
invalide toda la familia.

## 2. Cambio entregado (migración `0026_refresh_session_families`)

- `auth_sessions` gana `family_id` (obligatorio), `parent_session_id` y
  `consumed_at`, con índice por familia y restricciones de integridad
  (`consumed_at` implica `revoked_at`; un padre no puede ser la propia fila).
- El login abre una familia nueva (`family_id = id` de la sesión emitida). Las
  sesiones históricas se rellenan como familias propias.
- La rotación conserva `family_id`, registra `parent_session_id` y marca
  `consumed_at` en el token consumido.
- Si se presenta un token **consumido por rotación** fuera de la ventana de
  gracia, la función revoca todas las sesiones vivas de esa familia, audita
  `auth.refresh_reuse_detected` (`resource_type='session_family'`,
  `outcome='denied'`) y responde sin credenciales.
- La aplicación traduce ese estado a `401 SESSION_REUSE_DETECTED` y el flujo de
  cookie expira `bv_private_refresh` en la misma respuesta de error.

### Ventana de gracia de 10 segundos

Cubre el doble refresh concurrente legítimo (dos pestañas con la misma cookie).
El perdedor de la carrera recibe 401 sin token nuevo, por lo que la ventana no
entrega credenciales a un atacante; un replay posterior sí revoca la familia.
`consumed_at` (solo lo escribe la rotación) es distinto de `revoked_at`
(logout, cambio de contraseña, revocación administrativa): reproducir un token
cerrado deliberadamente no se interpreta como robo de credenciales.

### Orden y bloqueo

La rotación y la detección de replay comparten el bloqueo por usuario que ya
usaban login, cambio de contraseña y revocación. No se añaden rutas de bypass ni
se retiran controles existentes. La comprobación de MFA de la sesión renovada
ocurre dentro de la misma transacción: si falla, la rotación se revierte y el
token anterior sigue siendo el vigente.

## 3. Pruebas añadidas

`backend/tests/integration/test_refresh_reuse.py` (PostgreSQL desechable):

1. Linaje: familia constante, `parent_session_id` correcto, `consumed_at` solo
   en el padre y una sola sesión viva.
2. Replay fuera de la gracia: 401 `SESSION_REUSE_DETECTED`, cookie expirada,
   sucesor y JWT sucesor inválidos, familia completa revocada y un único evento
   `auth.refresh_reuse_detected` con el `resource_id` de la familia.
3. Replay dentro de la gracia: 401 `SESSION_EXPIRED` sin revocar la familia ni
   auditar reutilización.
4. Aislamiento: solo muere la familia comprometida; otra sesión del mismo
   usuario, otro usuario y otra organización (con sus JWT) siguen válidos.
5. Replay de un token cerrado por logout: 401 sin evento de reutilización.

`backend/tests/unit/test_refresh_cookie_policy.py`:

- `HttpOnly`, `SameSite=Strict`, `Path` acotado y `Secure` bajo https.
- Bajo http local/test no se emite `Secure` (límite operativo documentado).
- Sesión ya vencida ⇒ `Max-Age=0`.

## 4. Evidencia ejecutada

Entorno local de la sesión: PostgreSQL 16.2 embebido, rol de migraciones
distinto del rol de API, datos exclusivamente ficticios.

- `alembic upgrade head` y ciclo `downgrade base` → `upgrade head`: correctos.
- Ruta `0025` → `0026` con una sesión previa: `family_id = id` rellenado.
  La función heredada del *downgrade* se ejecutó realmente para comprobar que
  no referencia columnas eliminadas.
- `ruff check` y `ruff format --check`: correctos.
- `pytest -q` backend completo sobre TCP con `127.0.0.1` (para que también se
  ejecutasen las pruebas que solo corren contra PostgreSQL local):
  **397 aprobadas, 0 omitidas, 1 fallo**
  (`tests/integration/test_postgres.py::test_actual_database_has_revision`),
  que exige PostgreSQL 15 y por eso no aplica al servidor local 16.2; la CI
  nativa ejecuta ese caso sobre PostgreSQL 15.
- `pytest` focalizado (`test_refresh_reuse`, `test_session_rotation`,
  `test_cookie_access`, `test_jwt_access`, `test_account_security`,
  `test_mfa_step_up`, `test_first_admin_bootstrap`): 35 aprobadas.

La CI del primer intento detectó un fallo real que estas pruebas locales no
cubrían: `test_mfa_key_rotation.py` solo se ejecuta contra PostgreSQL en
`127.0.0.1` y su fixture inserta una sesión directamente. Tras la revisión de
ChatGPT se descartó un `DEFAULT` en la columna: `family_id` sigue siendo
`NOT NULL` **sin default**, de modo que ningún camino puede crear una sesión
sin linaje por omisión. La fixture declara ahora `family_id` explícito (la
sesión inicial abre su propia familia) y se revisó que no exista ningún otro
`INSERT` directo en pruebas. Con esa corrección la suite completa se ejecutó
localmente sin omisiones y la CI la validó sobre PostgreSQL 15.

### Evidencia de CI (run real)

- [CI 44989824988](https://github.com/erosCordova/bodyvision-ai/actions/runs/44989824988)
  sobre `73c9d5c`: `native-checks` (Ruff, migraciones, suite backend completa,
  ciclo de esquema, frontend, dependencias y navegador) **aprobado**;
  `docker-smoke` **aprobado**; `windows-scripts` **aprobado**.
- [Retención de pose 44989825018](https://github.com/erosCordova/bodyvision-ai/actions/runs/44989825018)
  **aprobada** sobre el mismo commit.
- El estado `Vercel` del PR aparece en fallo por el límite de compilaciones del
  plan de la cuenta (`build-rate-limit`), no por este cambio. No hubo despliegue
  productivo ni se autoriza ninguno.

Las suites aprobadas no sustituyen la revisión externa de seguridad ni
registran aceptación de fase.

## 5. Límites y pendientes que siguen abiertos

- Sigue siendo **local/test**: no hay habilitación productiva, ni datos reales,
  ni despliegue.
- "Recordarme", cierre por inactividad, modal de re-login sin perder el
  formulario y adopción del flujo de cookie por el frontend no están cerrados.
- Tras terminar el TLS en un proxy, `Secure` depende del esquema que ve la
  aplicación; sin cabeceras de proxy fiables habría que forzar la cookie segura
  por configuración antes de cualquier entorno real.
- Recuperación de contraseña objetivo con token de un solo uso, invitación por
  email real, matriz completa de roles, controles externos, MFA obligatoria en
  producción y revisión independiente de seguridad continúan pendientes.
- La detección de reutilización no sustituye la rotación en el cliente con
  "single flight"; solo evita que el doble refresh concurrente se castigue.
- No cambia porcentajes: F1/F3 no se consideran cerradas por esta entrega.
