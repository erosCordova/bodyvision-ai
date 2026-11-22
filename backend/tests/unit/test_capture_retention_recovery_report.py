"""Manifest and report rules for purge-versus-restore verification (no database)."""

import json
from uuid import uuid4

import pytest

from app.workers.capture_retention_recovery import (
    STATUS_DISCREPANCY,
    STATUS_NO_REAPPEARANCE,
    PurgedCapture,
    RecoveryVerificationDenied,
    build_report,
    load_manifest,
    require_verification_environment,
)


def _digest() -> str:
    return "a" * 64


def test_manifest_accepts_object_and_list_forms_and_deduplicates(tmp_path):
    identifier = uuid4()
    wrapped = tmp_path / "wrapped.json"
    wrapped.write_text(
        json.dumps({"purged_captures": [{"id": str(identifier), "sha256_digest": _digest()}]}),
        encoding="utf-8",
    )
    plain = tmp_path / "plain.json"
    plain.write_text(
        json.dumps(
            [
                {"id": str(identifier), "sha256_digest": _digest()},
                {"id": str(identifier), "sha256_digest": _digest()},
            ]
        ),
        encoding="utf-8",
    )

    assert load_manifest(wrapped) == (PurgedCapture(identifier, _digest()),)
    assert load_manifest(plain) == (PurgedCapture(identifier, _digest()),)


@pytest.mark.parametrize(
    "payload",
    [
        [],
        [{"id": str(uuid4()), "sha256_digest": "A" * 64}],
        [{"id": str(uuid4()), "sha256_digest": "a" * 63}],
        [{"id": "not-a-uuid", "sha256_digest": _digest()}],
        ["not-an-object"],
        {"purged_captures": "not a list"},
    ],
)
def test_manifest_rejects_malformed_entries(tmp_path, payload):
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(RecoveryVerificationDenied):
        load_manifest(path)


def test_manifest_rejects_unreadable_or_invalid_json(tmp_path):
    with pytest.raises(RecoveryVerificationDenied):
        load_manifest(tmp_path / "missing.json")
    invalid = tmp_path / "invalid.json"
    invalid.write_text("{not json", encoding="utf-8")
    with pytest.raises(RecoveryVerificationDenied):
        load_manifest(invalid)


def test_clean_comparison_never_becomes_a_global_deletion_verdict():
    manifest = (PurgedCapture(uuid4(), _digest()),)
    report = build_report(manifest, [])

    assert report["status"] == STATUS_NO_REAPPEARANCE
    assert report["global_verified_deletion"] is False
    assert report["checked_captures"] == 1
    assert report["reappeared_count"] == 0
    limits = " ".join(str(limit) for limit in report["limits"])
    for surface in ("WAL", "respaldo", "custodia externa"):
        assert surface in limits


def test_reappearance_is_a_discrepancy_and_never_a_success():
    manifest = (PurgedCapture(uuid4(), _digest()),)
    reappeared = [{"id": str(manifest[0].identifier), "sha256_digest": _digest()}]
    report = build_report(manifest, reappeared)

    assert report["status"] == STATUS_DISCREPANCY
    assert report["global_verified_deletion"] is False
    assert report["reappeared_count"] == 1


@pytest.mark.parametrize(
    "environment",
    [
        {},
        {"APP_ENV": "production", "BODYVISION_ENABLE_CAPTURE_RETENTION": "synthetic-only"},
        {"APP_ENV": "test"},
        {"APP_ENV": "test", "BODYVISION_ENABLE_CAPTURE_RETENTION": "synthetic-only"},
        {
            "APP_ENV": "test",
            "BODYVISION_ENABLE_CAPTURE_RETENTION": "synthetic-only",
            "RESTORED_DATABASE_URL": "sqlite:///restored.db",
        },
    ],
)
def test_verification_environment_denies_unsafe_configuration(environment):
    with pytest.raises(RecoveryVerificationDenied):
        require_verification_environment(environment)


def test_verification_environment_accepts_an_explicit_synthetic_restore():
    url = "postgresql+psycopg://postgres@127.0.0.1:5432/bodyvision_restored"
    assert (
        require_verification_environment(
            {
                "APP_ENV": "test",
                "BODYVISION_ENABLE_CAPTURE_RETENTION": "synthetic-only",
                "RESTORED_DATABASE_URL": url,
            }
        )
        == url
    )
