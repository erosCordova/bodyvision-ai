"""Explicit browser fixtures for an ephemeral loopback PostgreSQL database only.

This is test support, never an application bootstrap or public account setup.
Run after migrations and app.seed; discard the database after the browser run.
"""

import os
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.core.identity import hash_password
from app.db.session import SCHEMA_REVISION
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
            if revision != SCHEMA_REVISION:
                raise RuntimeError("Private browser fixtures require the current schema revision")
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
                (
                    UUID("30000000-0000-4000-8000-000000000003"),
                    SECOND_WORKSPACE,
                    "specialist",
                    "browser.outsider.editor@example.invalid",
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
            # Dedicated, explicitly granted read-only fixture for full CSV delivery.
            profile = UUID("70000000-0000-4000-8000-000000000001")
            admin = UUID("30000000-0000-4000-8000-000000000001")
            connection.execute(
                text("""INSERT INTO profiles
                    (id,organization_id,display_code,display_name,birth_year,created_by)
                    VALUES (:id,:org,'CSV-LARGO-FICTICIO','Historial CSV ficticio',1997,:actor)"""),
                {"id": profile, "org": FIRST_WORKSPACE, "actor": admin},
            )
            connection.execute(
                text("""INSERT INTO profile_access
                    (id,organization_id,profile_id,user_id,access_level)
                    VALUES (:id,:org,:profile,:actor,'read')"""),
                {"id": uuid4(), "org": FIRST_WORKSPACE, "profile": profile, "actor": admin},
            )
            start = datetime.now(UTC) - timedelta(days=10)
            connection.execute(
                text("""INSERT INTO measurements
                    (id,organization_id,profile_id,metric_code,value,unit,method,
                     measured_at,created_by)
                    VALUES (:id,:org,:profile,'weight',70,'kg','manual',:at,:actor)"""),
                [
                    {
                        "id": UUID(f"71000000-0000-4000-8000-{index:012d}"),
                        "org": FIRST_WORKSPACE,
                        "profile": profile,
                        "actor": admin,
                        "at": start + timedelta(seconds=index),
                    }
                    for index in range(2007)
                ],
            )
    finally:
        engine.dispose()


if __name__ == "__main__":
    seed_private_browser_accounts()
    print("Three synthetic browser accounts and an explicitly granted CSV fixture provisioned.")
