"""Optional synthetic-only retention worker independent of FastAPI.

Only expired encrypted capture rows may be deleted by the existing narrow
PostgreSQL SECURITY DEFINER function. No keys, images, HTTP, or owner role.
The database must stay running; this does NOT purge offline backups or WAL.
"""

import argparse
import os
import time
from collections.abc import Mapping

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, Engine, make_url
from sqlalchemy.exc import ArgumentError, SQLAlchemyError
from sqlalchemy.pool import NullPool

from app.workers.capture_retention import purge_due


class IndependentRetentionDenied(ValueError):
    """Refuse an unsafe environment without disclosing credentials."""


def require_synthetic_retention(environment: Mapping[str, str]) -> tuple[URL, int]:
    if environment.get("APP_ENV") not in {"local", "test"}:
        raise IndependentRetentionDenied("Retención autónoma: solo local/test.")
    if environment.get("IDENTITY_ENABLED", "").lower() != "true":
        raise IndependentRetentionDenied("Se requiere identidad sintética de prueba.")
    if environment.get("BODYVISION_ENABLE_CAPTURE_RETENTION") != "synthetic-only":
        raise IndependentRetentionDenied("Activación explícita de retención no autorizada.")
    try:
        url = make_url(environment.get("DATABASE_URL", ""))
    except (ArgumentError, ValueError, TypeError) as exc:
        raise IndependentRetentionDenied("Conexión de prueba inválida.") from exc
    if (
        url.drivername != "postgresql+psycopg"
        or url.username != "bodyvision_app"
        or url.host not in {"db", "localhost", "127.0.0.1", "::1"}
    ):
        raise IndependentRetentionDenied("Usa solo el rol de datos y PostgreSQL local.")
    try:
        interval = int(environment.get("CAPTURE_RETENTION_INTERVAL_SECONDS", "900"))
    except ValueError as exc:
        raise IndependentRetentionDenied("Intervalo de retención inválido.") from exc
    if not 60 <= interval <= 86400:
        raise IndependentRetentionDenied("Intervalo de retención fuera de rango.")
    return url, interval


def purge_independently(engine: Engine) -> int:
    # Verify the connected role; URL credentials alone must not grant authority.
    with engine.connect() as connection:
        role = connection.execute(text("SELECT current_user")).scalar_one()
        if role != "bodyvision_app":
            raise IndependentRetentionDenied("Rol de retención no autorizado.")
    return purge_due(engine, batch_size=100, max_batches=10)


def run_once(environment: Mapping[str, str]) -> int:
    url, _interval = require_synthetic_retention(environment)
    engine = create_engine(
        url,
        poolclass=NullPool,
        hide_parameters=True,
        pool_pre_ping=True,
        connect_args={"connect_timeout": 3, "options": "-c statement_timeout=5000"},
    )
    try:
        return purge_independently(engine)
    finally:
        engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Retención independiente solo ficticia")
    parser.add_argument("--once", action="store_true", help="Ejecutar una pasada y terminar")
    arguments = parser.parse_args(argv)
    try:
        environment = os.environ
        url, interval = require_synthetic_retention(environment)
        engine = create_engine(
            url,
            poolclass=NullPool,
            hide_parameters=True,
            pool_pre_ping=True,
            connect_args={"connect_timeout": 3, "options": "-c statement_timeout=5000"},
        )
        try:
            while True:
                try:
                    removed = purge_independently(engine)
                    print(f"retention.synthetic.deleted_count={removed}", flush=True)
                except IndependentRetentionDenied:
                    raise
                except SQLAlchemyError as exc:
                    # Never log SQL text, DSNs, user IDs or exception strings.
                    print(f"retention.synthetic.failed_type={type(exc).__name__}", flush=True)
                    if arguments.once:
                        return 1
                if arguments.once:
                    return 0
                time.sleep(interval)
        finally:
            engine.dispose()
    except (IndependentRetentionDenied, ValueError):
        print("Retención sintética deshabilitada o configuración no válida.", flush=True)
        return 2
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
