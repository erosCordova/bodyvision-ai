from unittest.mock import MagicMock

import pytest

from app.maintenance import recover_synthetic_mfa as recovery

ALLOWED = {
    "APP_ENV": "test",
    "IDENTITY_ENABLED": "true",
    "MFA_ENABLED": "true",
    "BODYVISION_ENABLE_MFA_ASSISTED_RECOVERY": "synthetic-only",
}
LOOPBACK = "postgresql+psycopg://postgres@127.0.0.1/bodyvision"


@pytest.mark.parametrize(
    "change,url",
    [
        ({"APP_ENV": "production"}, LOOPBACK),
        ({"APP_ENV": "demo"}, LOOPBACK),
        ({"APP_ENV": ""}, LOOPBACK),
        ({"IDENTITY_ENABLED": "false"}, LOOPBACK),
        ({"MFA_ENABLED": "false"}, LOOPBACK),
        ({"BODYVISION_ENABLE_MFA_ASSISTED_RECOVERY": ""}, LOOPBACK),
        ({}, "postgresql+psycopg://postgres@neon.tech/bodyvision"),
        ({}, "postgresql+psycopg://postgres@db-test/bodyvision"),
        ({}, "sqlite:///test.db"),
        ({}, "bad-url"),
    ],
)
def test_offline_recovery_denies_public_hosted_or_unapproved_use(change, url):
    with pytest.raises(recovery.RecoveryDenied):
        recovery.require_local_recovery({**ALLOWED, **change}, url)


def test_cli_does_not_connect_when_explicit_confirmation_is_missing(monkeypatch, capsys):
    from uuid import uuid4

    for key, value in {**ALLOWED, "MIGRATION_DATABASE_URL": LOOPBACK}.items():
        monkeypatch.setenv(key, value)
    answers = iter([str(uuid4()), str(uuid4()), str(uuid4()), "cancel"])
    monkeypatch.setattr("builtins.input", lambda _: next(answers))
    connect = MagicMock()
    monkeypatch.setattr(recovery, "create_engine", connect)
    assert recovery.main() == 1
    connect.assert_not_called()
    output = capsys.readouterr()
    assert not output.out
    assert "no se confirmó" in output.err
