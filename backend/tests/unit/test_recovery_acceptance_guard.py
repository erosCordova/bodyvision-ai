"""Recovery acceptance must remain explicit, loopback-only and secret-safe."""

import importlib.util
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from httpx import Response
from pydantic import ValidationError
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


def test_docker_host_allowlist_is_respected_by_recovery_client(monkeypatch):
    monkeypatch.setenv("ALLOWED_HOSTS", '["127.0.0.1","backend"]')
    monkeypatch.setenv("POSTGRES_APP_PASSWORD", "unused-for-live-route")
    config = recovery.settings("bodyvision", {"auth_password": "unused"}, None)
    with recovery.recovery_client(config) as client:
        assert client.get("/api/v1/health/live").status_code == 200
        assert (
            client.get("/api/v1/health/live", headers={"Host": "external.invalid"}).status_code
            == 400
        )


def test_mfa_recovery_requires_external_key_without_disabling_mfa(monkeypatch):
    monkeypatch.setenv("POSTGRES_APP_PASSWORD", "unused")
    with pytest.raises(ValidationError):
        recovery.settings("bodyvision_recovered_ci", {"auth_password": "unused"}, None, mfa=True)


def test_mfa_recovery_cannot_reuse_the_capture_key(monkeypatch):
    monkeypatch.setenv("POSTGRES_APP_PASSWORD", "unused")
    key = Fernet.generate_key().decode("ascii")
    with pytest.raises(ValidationError):
        recovery.settings(
            "bodyvision_recovered_ci", {"auth_password": "unused", "mfa_key": key}, key, mfa=True
        )


def test_restored_mfa_configuration_keeps_both_keys_distinct(monkeypatch):
    monkeypatch.setenv("POSTGRES_APP_PASSWORD", "unused")
    key, capture = (Fernet.generate_key().decode("ascii") for _ in range(2))
    config = recovery.settings(
        "bodyvision_recovered_ci", {"auth_password": "unused", "mfa_key": key}, capture, mfa=True
    )
    assert config.mfa_enabled and config.identity_enabled
    assert config.mfa_encryption_key.get_secret_value() == key
    assert config.capture_encryption_key.get_secret_value() == capture


@pytest.mark.parametrize("field", ["token", "recovery_codes"])
def test_negative_mfa_acceptance_rejects_credentials_in_error_payload(field, capsys):
    response = Response(401, json={"code": "MFA_CODE_INVALID", field: "secret-test-value"})
    with pytest.raises(recovery.RecoveryRejected):
        recovery.rejected_mfa(response, 401, "MFA_CODE_INVALID")
    assert "secret-test-value" not in capsys.readouterr().out


def test_http_runner_rejects_state_readable_by_other_users(monkeypatch, tmp_path):
    path = tmp_path / "state.json"
    path.write_text('{"private":"fixture-only"}')
    path.chmod(0o644)
    monkeypatch.setattr(recovery, "STATE", path)
    with pytest.raises(recovery.RecoveryRejected):
        recovery.read_state()


def test_http_runner_rejects_symlinked_private_state(monkeypatch, tmp_path):
    target = tmp_path / "target.json"
    target.write_text('{"private":"fixture-only"}')
    target.chmod(0o600)
    link = tmp_path / "state.json"
    link.symlink_to(target)
    monkeypatch.setattr(recovery, "STATE", link)
    with pytest.raises(recovery.RecoveryRejected):
        recovery.read_state()


def test_http_runner_reads_private_regular_state_without_output(monkeypatch, tmp_path, capsys):
    path = tmp_path / "state.json"
    path.write_text('{"private":"fixture-only"}')
    path.chmod(0o600)
    monkeypatch.setattr(recovery, "STATE", path)
    assert recovery.read_state() == {"private": "fixture-only"}
    assert capsys.readouterr().out == ""
