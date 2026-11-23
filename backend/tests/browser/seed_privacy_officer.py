"""A separate MFA browser administrator, only in an explicit disposable test DB."""

import os
from uuid import UUID, uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.core.identity import hash_password
from app.db.session import SCHEMA_REVISION
from app.models.context import FIRST_WORKSPACE


def seed() -> None:
    url = os.environ["TEST_DATABASE_URL"]
    parsed = make_url(url)
    if (
        os.environ.get("APP_ENV") != "test"
        or os.environ.get("PRIVATE_PRIVACY_BROWSER_FIXTURES") != "true"
        or parsed.drivername != "postgresql+psycopg"
        or parsed.host not in {"localhost", "127.0.0.1", "::1"}
        or parsed.database != "bodyvision"
        or parsed.username != "postgres"
    ):
        raise RuntimeError("Explicit, disposable, loopback privacy browser database required")
    engine = create_engine(url, hide_parameters=True)
    try:
        with engine.begin() as conn:
            if (
                conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
                != SCHEMA_REVISION
            ):
                raise RuntimeError("Current schema required")
            actor = UUID("30000000-0000-4000-8000-000000000030")
            conn.execute(
                text("""INSERT INTO users
              (id,organization_id,display_name,email,password_hash,is_local_operator,account_status)
              VALUES (:id,:org,'Administración de privacidad ficticia',
              'browser.privacy-admin@example.invalid',:hash,false,'active')"""),
                {
                    "id": actor,
                    "org": FIRST_WORKSPACE,
                    "hash": hash_password("Browser fixtures only 2026!"),
                },
            )
            conn.execute(
                text("""INSERT INTO user_role_assignments
              (id,organization_id,user_id,role) VALUES (:id,:org,:actor,'administrator')"""),
                {"id": uuid4(), "org": FIRST_WORKSPACE, "actor": actor},
            )
    finally:
        engine.dispose()


if __name__ == "__main__":
    seed()
    print("Isolated synthetic privacy-browser administrator prepared.")
