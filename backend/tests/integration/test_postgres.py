import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import ProgrammingError

from app.core.config import Settings
from app.main import create_app


@pytest.fixture
def database_url():
    value = os.environ.get("TEST_DATABASE_URL")
    if not value:
        pytest.skip("TEST_DATABASE_URL is required for real PostgreSQL integration")
    return value


def test_actual_database_has_revision(database_url):
    engine = create_engine(database_url)
    try:
        with engine.connect() as conn:
            assert conn.execute(text("SELECT revision FROM system_schema_state")).scalar_one() == (
                "0005_login_throttle"
            )
            assert conn.execute(text("SHOW server_version_num")).scalar_one().startswith("15")
    finally:
        engine.dispose()


def test_app_role_can_read_but_not_modify_schema(database_url):
    engine = create_engine(database_url)
    try:
        with engine.connect() as conn:
            transaction = conn.begin()
            conn.execute(text("SET LOCAL ROLE bodyvision_app"))
            assert conn.execute(text("SELECT revision FROM system_schema_state")).scalar_one()
            with pytest.raises(ProgrammingError):
                conn.execute(text("UPDATE system_schema_state SET revision = 'tampered'"))
            transaction.rollback()
        with engine.connect() as conn:
            transaction = conn.begin()
            conn.execute(text("SET LOCAL ROLE bodyvision_app"))
            with pytest.raises(ProgrammingError):
                conn.execute(text("CREATE TABLE public.forbidden (id integer)"))
            transaction.rollback()
    finally:
        engine.dispose()


def test_http_readiness_uses_real_database(database_url):
    app = create_app(Settings(app_env="test", database_url=database_url))
    with TestClient(app) as client:
        assert client.get("/api/v1/health/ready").status_code == 200
