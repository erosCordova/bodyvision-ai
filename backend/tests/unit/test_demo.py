from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


@pytest.mark.parametrize("method", ["POST", "PATCH", "PUT", "DELETE"])
def test_public_demo_rejects_writes_before_database_or_body_parsing(method):
    engine = MagicMock()
    settings = Settings(app_env="demo", database_url="postgresql+psycopg://app:test@localhost/test")
    with TestClient(create_app(settings, engine)) as client:
        response = client.request(method, "/api/v1/profiles", content="invalid body")
        assert response.status_code == 403
        assert response.json()["code"] == "DEMO_READ_ONLY"
        engine.connect.assert_not_called()


def test_render_hostname_is_explicit_and_production_stays_blocked(monkeypatch):
    monkeypatch.setenv("RENDER_EXTERNAL_HOSTNAME", "example.onrender.com")
    settings = Settings(app_env="demo", database_url="postgresql+psycopg://app:test@localhost/test")
    assert "example.onrender.com" in settings.allowed_hosts
    with pytest.raises(ValueError):
        Settings(app_env="production", database_url="postgresql+psycopg://app:test@localhost/test")
