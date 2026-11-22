"""Manifest and report rules for purge-versus-restore verification (no database)."""

import json
import os
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.workers.capture_retention_recovery import (
    MAX_MANIFEST_BYTES,
    MAX_MANIFEST_ENTRIES,
    STATUS_DISCREPANCY,
    STATUS_NO_REAPPEARANCE,
    PurgedCapture,
    RecoveryVerificationDenied,
    build_report,
    find_reappeared,
    load_manifest,
    read_only_engine,
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


def test_manifest_rejects_contradictory_digest_for_same_id(tmp_path):
    identifier = uuid4()
    path = tmp_path / "contradiction.json"
    path.write_text(
        json.dumps(
            [
                {"id": str(identifier), "sha256_digest": "a" * 64},
                {"id": str(identifier), "sha256_digest": "b" * 64},
            ]
        ),
        encoding="utf-8",
    )
    with pytest.raises(RecoveryVerificationDenied, match="contradictorio"):
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


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg://postgres@prod.example.org/bodyvision_restored",
        "postgresql+psycopg://postgres@db:5432/bodyvision_restored",
        "postgresql+psycopg://postgres",
        "postgresql+psycopg://invalid_host",
    ],
)
def test_verification_environment_rejects_nonlocal_or_missing_db_hosts(url):
    with pytest.raises(RecoveryVerificationDenied):
        require_verification_environment(
            {
                "APP_ENV": "test",
                "BODYVISION_ENABLE_CAPTURE_RETENTION": "synthetic-only",
                "RESTORED_DATABASE_URL": url,
            }
        )
    with pytest.raises(RecoveryVerificationDenied):
        read_only_engine(url)


def test_verifier_denies_unknown_role_when_row_security_is_active():
    connection = MagicMock()
    connection.execute.return_value.one.return_value = ("new_tenant_role", True, True)
    engine = MagicMock()
    engine.connect.return_value.__enter__.return_value = connection
    with pytest.raises(RecoveryVerificationDenied, match="sin RLS"):
        find_reappeared(engine, (PurgedCapture(uuid4(), _digest()),))
    assert connection.execute.call_count == 1


def test_verifier_denies_role_without_read_privilege():
    connection = MagicMock()
    connection.execute.return_value.one.return_value = ("qa_unauthorized", False, False)
    engine = MagicMock()
    engine.connect.return_value.__enter__.return_value = connection
    with pytest.raises(RecoveryVerificationDenied, match="autorizado"):
        find_reappeared(engine, (PurgedCapture(uuid4(), _digest()),))
    assert connection.execute.call_count == 1


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


def test_manifest_fails_closed_on_oversized_or_embedded_private_data(tmp_path):
    path = tmp_path / "manifest.json"
    path.write_bytes(b" " * (MAX_MANIFEST_BYTES + 1))
    with pytest.raises(RecoveryVerificationDenied):
        load_manifest(path)

    identifier = str(uuid4())
    for payload in (
        {"purged_captures": [{"id": identifier, "sha256_digest": _digest()}], "secret": "never"},
        [{"id": identifier, "sha256_digest": _digest(), "image": "secret"}],
        [{"id": identifier.upper(), "sha256_digest": _digest()}],
    ):
        path.write_text(json.dumps(payload), encoding="utf-8")
        with pytest.raises(RecoveryVerificationDenied):
            load_manifest(path)


def test_manifest_rejects_duplicate_json_keys_and_large_batches(tmp_path):
    path = tmp_path / "manifest.json"
    identifier = str(uuid4())
    path.write_text(
        '{"purged_captures": [], "purged_captures": [{"id": "'
        + identifier
        + '", "sha256_digest": "'
        + _digest()
        + '"}]}',
        encoding="utf-8",
    )
    with pytest.raises(RecoveryVerificationDenied):
        load_manifest(path)
    path.write_text(
        json.dumps([{"id": identifier, "sha256_digest": _digest()}] * (MAX_MANIFEST_ENTRIES + 1)),
        encoding="utf-8",
    )
    with pytest.raises(RecoveryVerificationDenied):
        load_manifest(path)


def test_manifest_rejects_hard_links_and_symbolic_links(tmp_path):
    path = tmp_path / "manifest.json"
    path.write_text(
        json.dumps([{"id": str(uuid4()), "sha256_digest": _digest()}]),
        encoding="utf-8",
    )
    hardlink = tmp_path / "hardlink.json"
    try:
        os.link(path, hardlink)
    except (OSError, NotImplementedError):
        pytest.skip("Hard links unavailable on this filesystem")
    with pytest.raises(RecoveryVerificationDenied):
        load_manifest(path)
    hardlink.unlink()
    symlink = tmp_path / "symlink.json"
    try:
        symlink.symlink_to(path)
    except (OSError, NotImplementedError):
        pytest.skip("Symbolic links unavailable on this filesystem")
    with pytest.raises(RecoveryVerificationDenied):
        load_manifest(symlink)


def test_programmatic_verifier_rejects_unsafe_batch_before_connecting():
    engine = MagicMock()
    valid = PurgedCapture(uuid4(), _digest())
    for manifest in (
        [valid] * (MAX_MANIFEST_ENTRIES + 1),
        [valid, valid],
        [PurgedCapture(uuid4(), "wrong")],
    ):
        with pytest.raises(RecoveryVerificationDenied):
            find_reappeared(engine, manifest)
    engine.connect.assert_not_called()


def test_manifest_rejects_named_pipe_without_waiting_for_writer(tmp_path):
    if not hasattr(os, "mkfifo"):
        pytest.skip("Named pipes unavailable on this filesystem")
    fifo = tmp_path / "fifo.json"
    os.mkfifo(fifo)
    with pytest.raises(RecoveryVerificationDenied):
        load_manifest(fifo)


def test_programmatic_verifier_accepts_canonical_string_uuid_without_weakening_checks():
    identifier = uuid4()
    connection = MagicMock()
    connection.execute.side_effect = [
        MagicMock(one=lambda: ("postgres", False, True)),
        MagicMock(all=lambda: []),
    ]
    engine = MagicMock()
    engine.connect.return_value.__enter__.return_value = connection
    assert find_reappeared(engine, (PurgedCapture(str(identifier), _digest()),)) == []
    arguments = connection.execute.call_args.args
    assert arguments[1]["identifiers"] == [identifier]

    engine.connect.reset_mock()
    for invalid in (
        PurgedCapture(str(identifier).upper(), _digest()),
        PurgedCapture("invalid", _digest()),
    ):
        with pytest.raises(RecoveryVerificationDenied):
            find_reappeared(engine, (invalid,))
    with pytest.raises(RecoveryVerificationDenied):
        find_reappeared(
            engine,
            (PurgedCapture(identifier, _digest()), PurgedCapture(str(identifier), _digest())),
        )
    engine.connect.assert_not_called()
