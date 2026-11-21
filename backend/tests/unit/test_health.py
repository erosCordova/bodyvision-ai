import json
import logging
from io import StringIO
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.exc import OperationalError

from app.core.config import Settings
from app.core.logging import JsonFormatter
from app.core.mfa import generate_mfa_encryption_key
from app.main import create_app


@pytest.fixture
def engine():
    engine = MagicMock()
    connection = engine.connect.return_value.__enter__.return_value
    connection.execute.return_value.scalar_one.return_value = "0021_pose_retention"
    return engine


@pytest.fixture
def client(engine):
    settings = Settings(app_env="test", database_url="postgresql+psycopg://app:test@localhost/test")
    with TestClient(create_app(settings, engine)) as client:
        yield client


def test_live_does_not_require_database(client, engine):
    engine.connect.side_effect = OperationalError("db", {}, Exception("sensitive"))
    response = client.get("/api/v1/health/live")
    assert response.status_code == 200
    assert response.json()["environment"] == "test"
    engine.connect.assert_not_called()


def test_ready_requires_migration(client):
    response = client.get("/api/v1/health/ready")
    assert response.status_code == 200
    assert response.json()["schema_revision"] == "0021_pose_retention"


def test_demo_ready_uses_data_core_revision(client, engine):
    demo_settings = client.app.state.settings.model_copy(update={"app_env": "demo"})
    connection = engine.connect.return_value.__enter__.return_value
    connection.execute.return_value.scalar_one.return_value = "0002_data_core"
    with TestClient(create_app(demo_settings, engine)) as demo:
        response = demo.get("/api/v1/health/ready")
        assert response.status_code == 200
        assert response.json()["schema_revision"] == "0002_data_core"
        connection.execute.return_value.scalar_one.return_value = "0021_pose_retention"
        assert demo.get("/api/v1/health/ready").status_code == 503


def test_database_failure_returns_safe_error(client, engine):
    engine.connect.side_effect = OperationalError("secret_sql", {}, Exception("secret_password"))
    response = client.get("/api/v1/health/ready")
    assert response.status_code == 503
    assert response.json()["code"] == "NOT_READY"
    assert "secret" not in response.text
    UUID(response.json()["correlation_id"])


def test_wrong_schema_is_not_ready(client, engine):
    connection = engine.connect.return_value.__enter__.return_value
    connection.execute.return_value.scalar_one.return_value = "wrong"
    assert client.get("/api/v1/health/ready").status_code == 503


def test_unknown_resource_has_contract(client):
    response = client.get("/api/v1/missing/private-code?email=private@example.com")
    assert response.status_code == 404
    assert set(response.json()) == {"code", "message", "details", "correlation_id"}
    assert "private" not in response.text


def test_invalid_correlation_header_is_replaced(client):
    response = client.get(
        "/api/v1/health/live", headers={"X-Correlation-ID": "private@example.com"}
    )
    UUID(response.headers["X-Correlation-ID"])


def test_valid_correlation_and_security_headers(client):
    identifier = "af32b2e1-c1b8-4b26-9bbf-94e9ddd1ec67"
    response = client.get("/api/v1/health/live", headers={"X-Correlation-ID": identifier})
    assert response.headers["X-Correlation-ID"] == identifier
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_cors_does_not_allow_foreign_origins(client):
    response = client.options(
        "/api/v1/health/live",
        headers={
            "Origin": "https://foreign.invalid",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert "access-control-allow-origin" not in response.headers


def test_logs_do_not_contain_path_query_or_arbitrary_header(client):
    output = StringIO()
    handler = logging.StreamHandler(output)
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger("bodyvision")
    logger.addHandler(handler)
    try:
        client.get(
            "/private-person?email=private@example.com",
            headers={
                "X-Correlation-ID": "private-name",
                "Authorization": "Bearer secret",
            },
        )
    finally:
        logger.removeHandler(handler)
    payload = json.loads(output.getvalue())
    assert payload["route"] == "unmatched"
    assert "private" not in output.getvalue()
    assert "secret" not in output.getvalue()


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_unreleased_environments_cannot_boot(environment):
    with pytest.raises(ValidationError, match="local/test only"):
        Settings(app_env=environment, database_url="postgresql+psycopg://app:test@localhost/test")


@pytest.mark.parametrize(
    "override",
    [
        {"debug": True},
        {"cors_origins": ["*"]},
        {"allowed_hosts": ["*"]},
        {"database_url": "sqlite://"},
    ],
)
def test_unsafe_configuration_is_rejected(override):
    config = {"database_url": "postgresql+psycopg://app:test@localhost/test", **override}
    with pytest.raises(ValidationError):
        Settings(**config)


def test_mfa_never_starts_without_private_identity_and_a_valid_secret():
    base = {
        "app_env": "test",
        "database_url": "postgresql+psycopg://app:test@localhost/test",
        "auth_database_url": "postgresql+psycopg://auth:test@localhost/test",
    }
    with pytest.raises(ValidationError):
        Settings(**base, mfa_enabled=True, identity_enabled=False)
    with pytest.raises(ValidationError):
        Settings(**base, mfa_enabled=True, identity_enabled=True)
    with pytest.raises(ValidationError):
        Settings(**base, mfa_enabled=True, identity_enabled=True, mfa_encryption_key="invalid-key")
    config = Settings(
        **base,
        mfa_enabled=True,
        identity_enabled=True,
        mfa_encryption_key=generate_mfa_encryption_key(),
    )
    assert config.mfa_enabled


def test_openapi_contains_foundation_only(client):
    paths = client.get("/api/v1/openapi.json").json()["paths"]
    assert {"/api/v1/health/live", "/api/v1/health/ready"}.issubset(paths)
    assert "/api/v1/profiles/{profile_id}/media" not in paths
