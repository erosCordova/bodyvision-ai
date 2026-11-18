"""Launch the synthetic API against managed Neon PostgreSQL.

No PostgreSQL server, database files, bootstrap, fixtures, or migration
permissions are ever included in the Render web-service container.
"""

import os
import sys
from urllib.parse import parse_qs, urlsplit


def run() -> int:
    if os.environ.get("APP_ENV") != "demo":
        print("Demo API requires APP_ENV=demo.", flush=True)
        return 1
    database_url = os.environ.get("DATABASE_URL", "")
    parsed = urlsplit(database_url)
    hostname = parsed.hostname or ""
    sslmode = parse_qs(parsed.query).get("sslmode", [])
    if not (
        parsed.scheme == "postgresql+psycopg"
        and (hostname == "neon.tech" or hostname.endswith(".neon.tech"))
        and "require" in sslmode
    ):
        print("A secure Neon PostgreSQL connection is required.", flush=True)
        return 1
    port = os.environ.get("PORT", "10000")
    if not port.isdigit() or not 1 <= int(port) <= 65535:
        print("Invalid HTTP port.", flush=True)
        return 1
    print("BODYVISION synthetic read-only API: external Neon PostgreSQL.", flush=True)
    os.execvpe(
        sys.executable,
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:create_app",
            "--factory",
            "--host",
            "0.0.0.0",
            "--port",
            port,
            "--no-access-log",
        ],
        os.environ.copy(),
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(run())
