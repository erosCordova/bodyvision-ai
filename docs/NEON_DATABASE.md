# BODYVISION AI: Neon-managed PostgreSQL

**Only Neon is allowed for hosted project databases.** Render may run the
HTTP backend but may NOT start, bundle, or persist a PostgreSQL database.
No Supabase or Render PostgreSQL is used.

## Active hosted database

- Provider: Neon (separate project `bodyvision-ai`)
- PostgreSQL major version: 15
- Database: `bodyvision`
- Region: `aws-us-west-2`
- Project: `square-dream-70203778`
- Default branch: `main`
- Runtime login: `bodyvision_app`, with SELECT-only table privileges and
  read-only default transactions
- Schema revision: `0002_data_core`, installed using managed Neon SQL
- Initial records: synthetic organizations, fictitious profiles and
  observations. No patient information has been transferred.

## Runtime

The hosted FastAPI demonstration receives `DATABASE_URL` as a **secret**
environment variable from Render's service configuration. The URL MUST use
`postgresql+psycopg://`, a `.neon.tech` host, and `sslmode=require`.
Neither a password nor a connection URL may appear in GitHub, build logs,
documentation, browser code, or a client-side environment variable.

`infra/demo/Dockerfile` contains Python and the FastAPI application only;
it does not contain PostgreSQL binaries. `app.demo_runtime` validates the
external Neon connection and starts the API. It never runs `initdb`,
`postgres`, `alembic`, or `seed`.

**Do not automatically run migrations or seeding on API startup.**
A migration on the managed database must be explicitly reviewed, tested,
backed up as appropriate and executed using a separate migration identity.
The local Docker-based PostgreSQL service in `compose.yaml` is a disposable
development/test dependency, not a hosted database.

The demo remains synthetic and read-only. Production with real people's
data is blocked until authentication, consent, audit and privacy gates pass.
