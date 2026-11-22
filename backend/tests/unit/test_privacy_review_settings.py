"""Invalid internal targets fail before a private service can start."""

import pytest
from pydantic import ValidationError

from app.core.config import Settings

BASE = {"app_env": "test", "database_url": "postgresql+psycopg://app:test@localhost/test"}


@pytest.mark.parametrize("days", [0, -1, 31, 1.5, "tomorrow"])
def test_invalid_privacy_review_target_is_rejected(days):
    with pytest.raises(ValidationError):
        Settings(**BASE, privacy_review_target_days=days)


def test_privacy_review_target_from_environment_is_bounded(monkeypatch):
    monkeypatch.setenv("PRIVACY_REVIEW_TARGET_DAYS", "1")
    assert Settings(**BASE).privacy_review_target_days == 1
    monkeypatch.setenv("PRIVACY_REVIEW_TARGET_DAYS", "30")
    assert Settings(**BASE).privacy_review_target_days == 30
    monkeypatch.setenv("PRIVACY_REVIEW_TARGET_DAYS", "31")
    with pytest.raises(ValidationError):
        Settings(**BASE)
