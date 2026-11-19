"""Explicit browser fixtures for an ephemeral loopback PostgreSQL database only.

This is test support, never an application bootstrap or public account setup.
Run after migrations and app.seed; discard the database after the browser run.
"""

import os
from uuid import UUID, uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.core.identity import hash_password
from app.models.context import FIRST_WORKSPACE, SECOND_WORKSPACE

PASSWORD = "Browser fixtures only 2026!"


def seed_private_browser_accounts() -> None:
    if os.environ.get("APP_ENV") != "test" or os.environ.get("PRIVATE_BROWSER_FIXTURES") != "true":
        raise RuntimeError("Explicit disposable browser test mode is required")
    database_url = os.environ["TEST_DATABASE_URL"]
    parsed = make_url(database_url)
    if (
        parsed.drivername != "postgresql+psycopg"
        or parsed.host not in {"127.0.0.1", "localhost", "::1"}
        or parsed.database != "bodyvision"
        or parsed.username != "postgres"
    ):
        raise RuntimeError("Browser fixtures require the ephemeral loopback CI database")
    engine = create_engine(database_url, hide_parameters=True)
    try:
        with engine.begin() as connection:
            revision = connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one()
            if revision != "0016_simulation_scenarios":
                raise RuntimeError("Browser fixtures require the reviewed private simulation test schema")
            for identifier, organization, role, email in [
                (
                    UUID("30000000-0000-4000-8000-000000000001"),
                    FIRST_WORKSPACE,
                    "administrator",
                    "browser.admin@example.invalid",
                ),
                (
                    UUID("30000000-0000-4000-8000-000000000002"),
                    SECOND_WORKSPACE,
                    "member",
                    "browser.outsider@example.invalid",
                ),
            ]:
                # Fail on repeated setup instead of resetting active accounts.
                connection.execute(
                    text("""
                        INSERT INTO users(id,organization_id,display_name,email,
                          password_hash,is_local_operator,account_status)
                        VALUES (:id,:org,'Cuenta ficticia de navegador',:email,:hash,false,'active')
                    """),
                    {
                        "id": identifier,
                        "org": organization,
                        "email": email,
                        "hash": hash_password(PASSWORD),
                    },
                )
                connection.execute(
                    text("""
                        INSERT INTO user_role_assignments(id,organization_id,user_id,role)
                        VALUES (:id,:org,:user,:role)
                    """),
                    {"id": uuid4(), "org": organization, "user": identifier, "role": role},
                )
    finally:
        engine.dispose()


if __name__ == "__main__":
    seed_private_browser_accounts()
    print("Two synthetic browser accounts provisioned; no implicit profile grants.")
