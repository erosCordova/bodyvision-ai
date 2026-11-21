"""Recovery acceptance must remain explicit, loopback-only and secret-safe."""

import importlib.util
from pathlib import Path

import pytest
from sqlalchemy.engine import make_url

SPEC = importlib.util.spec_from_file_location(
    "recovery_acceptance", Path(__file__).parents[1] / "recovery_acceptance.py"
)
recovery = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(recovery)


def environment():
    return {
        "APP_ENV": "test",
        "CI": "true",
        "BODYVISION_RESTORE_DRILL": "synthetic-only",
        "POSTGRES_DB": "bodyvision",
        "POSTGRES_USER": "postgres",
        "POSTGRES_PASSWORD": "ephemeral-owner",
        "POSTGRES_APP_PASSWORD": "ephemeral-app",
    }


@pytest.mark.parametrize("key", list(environment()))
def test_missing_opt_in_or_database_credential_blocks_recovery(key):
    configured = environment()
    configured.pop(key)
    with pytest.raises(recovery.RecoveryRejected):
        recovery.guard(configured)


@pytest.mark.parametrize(
    "key,value",
    [
        ("APP_ENV", "production"),
        ("APP_ENV", "local"),
        ("POSTGRES_DB", "hosted"),
        ("POSTGRES_USER", "hosted_owner"),
        ("BODYVISION_RESTORE_DRILL", "enabled"),
    ],
)
def test_hosted_or_implicit_configuration_is_rejected(key, value):
    configured = {**environment(), key: value}
    with pytest.raises(recovery.RecoveryRejected):
        recovery.guard(configured)


def test_disposable_target_is_fixed_to_loopback_and_distinct_roles():
    recovery.guard(environment())
    parsed = make_url(recovery.database_url("bodyvision_recovered_ci", "bodyvision_app", "a:@/b"))
    assert parsed.host == "127.0.0.1" and parsed.port == 5432
    assert parsed.password == "a:@/b" and parsed.username == "bodyvision_app"
    with pytest.raises(recovery.RecoveryRejected):
        recovery.database_url("hosted", "bodyvision_app", "unused")
    with pytest.raises(recovery.RecoveryRejected):
        recovery.database_url("bodyvision", "arbitrary_owner", "unused")


def test_cli_redacts_driver_exceptions_and_never_prints_credentials(monkeypatch, capsys):
    monkeypatch.setattr(recovery.logging, "disable", lambda level: None)
    for key, value in environment().items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr("sys.argv", ["recovery", "prepare"])

    def fail():
        raise RuntimeError("postgresql://secret-account:private-key@hosted.invalid/person-id")

    monkeypatch.setattr(recovery, "prepare", fail)
    assert recovery.main() == 2
    output = capsys.readouterr().out
    assert "RuntimeError" in output
    assert "secret-account" not in output
    assert "private-key" not in output
    assert "hosted.invalid" not in output
