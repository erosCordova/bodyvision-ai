"""Disposable PostgreSQL + read-only API for a synthetic cloud demonstration only."""

import os
import secrets
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import psycopg
from psycopg import sql


def run() -> int:
    if os.environ.get("APP_ENV") != "demo":
        print("Demo runtime requires APP_ENV=demo.", flush=True)
        return 1
    pg_bin = Path(os.environ.get("BV_PG_BIN", "/usr/lib/postgresql/15/bin"))
    pg_share = os.environ.get("BV_PG_SHARE", "/usr/share/postgresql/15")
    pg_port = int(os.environ.get("BV_PG_PORT", "5432"))
    http_port = int(os.environ.get("PORT", "10000"))
    owner_password = secrets.token_hex(32)
    app_password = secrets.token_hex(32)
    children: list[subprocess.Popen] = []
    stopping = False

    def stop(signum, frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    with tempfile.TemporaryDirectory(prefix="bodyvision-demo-") as directory:
        data = Path(directory) / "data"
        try:
            subprocess.run(
                [
                    str(pg_bin / "initdb"),
                    "-D",
                    str(data),
                    "-L",
                    pg_share,
                    "--username=postgres",
                    "--auth-local=scram-sha-256",
                    "--auth-host=scram-sha-256",
                    "--pwfile=/dev/stdin",
                    "--no-locale",
                    "-E",
                    "UTF8",
                ],
                input=owner_password + "\n",
                text=True,
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            postgres = subprocess.Popen(
                [
                    str(pg_bin / "postgres"),
                    "-D",
                    str(data),
                    "-h",
                    "127.0.0.1",
                    "-p",
                    str(pg_port),
                    "-c",
                    "unix_socket_directories=",
                    "-c",
                    "max_connections=20",
                    "-c",
                    "shared_buffers=16MB",
                    "-c",
                    "work_mem=1MB",
                    "-c",
                    "maintenance_work_mem=16MB",
                    "-c",
                    "log_min_error_statement=fatal",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            children.append(postgres)
            for _ in range(200):
                if postgres.poll() is not None or stopping:
                    raise RuntimeError("Database startup interrupted")
                try:
                    connection = psycopg.connect(
                        host="127.0.0.1",
                        port=pg_port,
                        user="postgres",
                        password=owner_password,
                        dbname="postgres",
                        autocommit=True,
                        connect_timeout=1,
                    )
                    break
                except psycopg.OperationalError:
                    time.sleep(0.1)
            else:
                raise RuntimeError("Database did not start")
            with connection:
                connection.execute(
                    sql.SQL(
                        "CREATE ROLE bodyvision_app LOGIN PASSWORD {} "
                        "NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS"
                    ).format(sql.Literal(app_password))
                )
                connection.execute("CREATE DATABASE bodyvision")
            with psycopg.connect(
                host="127.0.0.1",
                port=pg_port,
                user="postgres",
                password=owner_password,
                dbname="bodyvision",
                autocommit=True,
            ) as connection:
                connection.execute("REVOKE CREATE ON SCHEMA public FROM PUBLIC")
                connection.execute("GRANT USAGE ON SCHEMA public TO bodyvision_app")
                connection.execute("ALTER ROLE bodyvision_app SET default_transaction_read_only=on")
            owner_url = (
                f"postgresql+psycopg://postgres:{owner_password}@127.0.0.1:{pg_port}/bodyvision"
            )
            app_url = (
                f"postgresql+psycopg://bodyvision_app:{app_password}@127.0.0.1:{pg_port}/bodyvision"
            )
            migration_env = {**os.environ, "MIGRATION_DATABASE_URL": owner_url}
            subprocess.run(
                [sys.executable, "-m", "alembic", "upgrade", "head"], env=migration_env, check=True
            )
            # Seeding is explicitly local/test-only; this short-lived child never exposes a server.
            subprocess.run(
                [sys.executable, "-m", "app.seed"],
                env={**migration_env, "APP_ENV": "test"},
                check=True,
            )
            runtime_env = {**os.environ, "DATABASE_URL": app_url, "APP_ENV": "demo"}
            runtime_env.pop("MIGRATION_DATABASE_URL", None)
            runtime_env.pop("POSTGRES_PASSWORD", None)
            api = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "app.main:create_app",
                    "--factory",
                    "--host",
                    "0.0.0.0",
                    "--port",
                    str(http_port),
                    "--no-access-log",
                ],
                env=runtime_env,
            )
            children.append(api)
            print("Synthetic read-only demo started; data is regenerated on restart.", flush=True)
            while not stopping:
                if any(child.poll() is not None for child in children):
                    raise RuntimeError("Demo subprocess stopped")
                time.sleep(0.5)
            return 0
        except Exception:
            # Do not print exceptions: connection information must stay out of logs.
            print(
                "Demo startup/runtime failed; no personal data or credentials logged.", flush=True
            )
            return 1
        finally:
            # API first, then fast PostgreSQL shutdown. Respect the platform SIGTERM window.
            for child in reversed(children):
                if child.poll() is None:
                    child.send_signal(signal.SIGINT)
                    try:
                        child.wait(timeout=8)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait()


if __name__ == "__main__":
    raise SystemExit(run())
