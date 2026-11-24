import base64
import os

import pytest

from app.core.config import Settings


def private_settings(**overrides):
    values = {
        "app_env": "test",
        "database_url": "postgresql+psycopg://fictional_app@localhost/example",
        "auth_database_url": "postgresql+psycopg://fictional_auth@localhost/example",
        "identity_enabled": True,
        "report_signing_key": os.urandom(32).hex(),
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_report_key_is_optional_and_validated():
    assert private_settings(report_signing_key=None).report_signing_key is None
    assert private_settings().report_signing_key is not None
    for changes in (
        {"report_signing_key": "not-a-key"},
        {"identity_enabled": False},
        {"app_env": "demo"},
        {"app_env": "production"},
    ):
        with pytest.raises(ValueError):
            private_settings(**changes)


@pytest.mark.parametrize(
    "key_field", ["jwt_signing_key", "mfa_encryption_key", "capture_encryption_key"]
)
def test_reject_cross_purpose_key_reuse(key_field):
    seed = os.urandom(32)
    encoded = base64.urlsafe_b64encode(seed).decode("ascii")
    if key_field == "jwt_signing_key":
        encoded = encoded.rstrip("=")
    with pytest.raises(ValueError, match="distinct"):
        private_settings(report_signing_key=seed.hex(), **{key_field: encoded})
