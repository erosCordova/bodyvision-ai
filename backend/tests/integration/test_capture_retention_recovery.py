"""Purge-versus-restore rehearsal for synthetic encrypted captures.

1. The API stores a fictional PNG under valid consent and permissions.
2. The capture expires; the independent worker runs in a **separate process**
   with no JWT, MFA or capture keys, proving the purge needs no API.
3. An isolated database is rebuilt from migrations and filled with the
   pre-purge row, simulating an older backup. The read-only verifier must
   report the reappearance as a discrepancy and keep
   ``global_verified_deletion`` false.
"""

import hashlib
import os
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from cryptography.fernet import Fernet
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from test_authenticated_api import _synthetic_png, authenticate, headers
from test_authenticated_api import protected as protected

from alembic import command
from app.models.context import FIRST_WORKSPACE, SECOND_WORKSPACE
from app.workers.capture_retention_recovery import (
    STATUS_DISCREPANCY,
    STATUS_NO_REAPPEARANCE,
    PurgedCapture,
    RecoveryVerificationDenied,
    RecoveryVerificationError,
    find_reappeared,
    read_only_engine,
    verify_restored_copy,
)

BACKEND = Path(__file__).resolve().parents[2]
LOOPBACK = {"localhost", "127.0.0.1", "::1"}


def _data_role_url() -> str:
    url = os.environ.get("DATABASE_URL", "")
    parsed = make_url(url) if url else None
    if not parsed or parsed.username != "bodyvision_app" or parsed.host not in LOOPBACK:
        pytest.skip("Offline retention rehearsal runs with the loopback data role")
    return url


def _admin_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL", "")
    if not url:
        pytest.skip("Requires a disposable PostgreSQL administrator")
    return url


def _consent(client, token, profile_id):
    for purpose in ("capture", "storage"):
        accepted = client.post(
            f"/api/v1/auth/profiles/{profile_id}/consents",
            headers=headers(token),
            json={"purpose": purpose, "version": "bv-synthetic-v1", "confirmed": True},
        )
        assert accepted.status_code == 200, accepted.text


def _upload(client, token, profile_id):
    image = _synthetic_png()
    response = client.post(
        f"/api/v1/profiles/{profile_id}/captures",
        content=image,
        headers={
            **headers(token),
            "Content-Type": "image/png",
            "X-Synthetic-Only": "confirmed",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _expire(owner, capture_id):
    with owner.begin() as connection:
        connection.execute(
            text(
                "UPDATE synthetic_capture_objects "
                "SET created_at=now()-interval '8 days',expires_at=now()-interval '1 day' "
                "WHERE id=:id"
            ),
            {"id": capture_id},
        )


def _run_worker() -> str:
    """Start the independent worker as a separate interpreter, API not serving."""
    environment = {
        "APP_ENV": "test",
        "IDENTITY_ENABLED": "true",
        "BODYVISION_ENABLE_CAPTURE_RETENTION": "synthetic-only",
        "DATABASE_URL": _data_role_url(),
        "PYTHONPATH": str(BACKEND),
        "PATH": os.environ.get("PATH", ""),
    }
    # No JWT, MFA or capture-encryption keys are provided on purpose.
    result = subprocess.run(
        [sys.executable, "-m", "app.workers.independent_capture_retention", "--once"],
        cwd=BACKEND,
        env=environment,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert result.returncode == 0, (result.stdout, result.stderr)
    return result.stdout


def _deleted_count(output: str) -> int:
    for line in output.splitlines():
        if line.startswith("retention.synthetic.deleted_count="):
            return int(line.split("=", 1)[1])
    raise AssertionError(f"worker did not report a count: {output!r}")


def _capture_row(owner, capture_id):
    with owner.connect() as connection:
        return (
            connection.execute(
                text(
                    "SELECT id,sha256_digest,ciphertext FROM synthetic_capture_objects WHERE id=:id"
                ),
                {"id": capture_id},
            )
            .mappings()
            .first()
        )


def _create_isolated_database(monkeypatch, name: str) -> tuple[str, str]:
    admin = _admin_url()
    server = str(make_url(admin).set(database="postgres"))
    autocommit = create_engine(server, isolation_level="AUTOCOMMIT", hide_parameters=True)
    try:
        with autocommit.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
            connection.execute(text(f'CREATE DATABASE "{name}"'))
    finally:
        autocommit.dispose()
    restored = str(make_url(admin).set(database=name))
    monkeypatch.setenv("MIGRATION_DATABASE_URL", restored)
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "alembic"))
    command.upgrade(config, "head")
    return server, restored


def _drop_isolated_database(server: str, name: str) -> None:
    autocommit = create_engine(server, isolation_level="AUTOCOMMIT", hide_parameters=True)
    try:
        with autocommit.connect() as connection:
            connection.execute(
                text("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=:n"),
                {"n": name},
            )
            connection.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
    finally:
        autocommit.dispose()


def _seed_restored_backup(restored_url, capture_id, digest, ciphertext):
    """Place the pre-purge row in the restored copy, as an old backup would."""
    engine = create_engine(restored_url, hide_parameters=True)
    try:
        with engine.begin() as connection:
            founder = connection.execute(
                text(
                    "SELECT id FROM users WHERE organization_id=:org "
                    "AND is_local_operator ORDER BY id LIMIT 1"
                ),
                {"org": FIRST_WORKSPACE},
            ).scalar_one()
            profile = connection.execute(
                text(
                    "INSERT INTO profiles"
                    "(id,organization_id,display_code,birth_year,created_by) "
                    "VALUES (:id,:org,:code,1999,:actor) RETURNING id"
                ),
                {
                    "id": uuid4(),
                    "org": FIRST_WORKSPACE,
                    "code": "RST-" + digest[:10].upper(),
                    "actor": founder,
                },
            ).scalar_one()
            connection.execute(
                text(
                    "INSERT INTO synthetic_capture_objects("
                    "id,organization_id,profile_id,created_by,original_bytes,width,height,"
                    "sha256_digest,ciphertext,created_at,expires_at) VALUES ("
                    ":id,:org,:profile,:actor,:size,32,64,:digest,:ciphertext,"
                    "now()-interval '8 days',now()-interval '1 day')"
                ),
                {
                    "id": capture_id,
                    "org": FIRST_WORKSPACE,
                    "profile": profile,
                    "actor": founder,
                    "size": 2048,
                    "digest": digest,
                    "ciphertext": ciphertext,
                },
            )
    finally:
        engine.dispose()


def test_worker_purges_expired_ciphertext_without_the_api(protected):
    _data_role_url()
    client, owner, profile_id, users = protected
    token = authenticate(client, *users[0][:2]).json()["token"]
    _consent(client, token, profile_id)
    image = _synthetic_png()
    expired = _upload(client, token, profile_id)
    kept = _upload(client, token, profile_id)
    assert expired["sha256_digest"] == hashlib.sha256(image).hexdigest()
    assert _capture_row(owner, expired["id"]) is not None
    _expire(owner, expired["id"])
    _expire(owner, kept["id"])

    assert _deleted_count(_run_worker()) == 2
    assert _capture_row(owner, expired["id"]) is None
    assert _capture_row(owner, kept["id"]) is None
    with owner.connect() as connection:
        latest = connection.execute(
            text(
                "SELECT deleted_count FROM synthetic_capture_maintenance_events "
                "ORDER BY id DESC LIMIT 1"
            )
        ).scalar_one()
    assert latest == 2
    # Idempotent: a second independent pass deletes nothing.
    assert _deleted_count(_run_worker()) == 0


def test_restored_backup_reappearance_is_a_discrepancy(protected, monkeypatch):
    _data_role_url()
    client, owner, profile_id, users = protected
    token = authenticate(client, *users[0][:2]).json()["token"]
    _consent(client, token, profile_id)
    capture = _upload(client, token, profile_id)
    before = _capture_row(owner, capture["id"])
    assert before is not None
    digest = str(before["sha256_digest"]).strip()
    manifest = (PurgedCapture(capture["id"], digest),)
    _expire(owner, capture["id"])
    assert _deleted_count(_run_worker()) == 1
    assert _capture_row(owner, capture["id"]) is None

    name = "bodyvision_restore_" + os.urandom(4).hex()
    server, restored = _create_isolated_database(monkeypatch, name)
    restored_engine = None
    try:
        _seed_restored_backup(restored, capture["id"], digest, before["ciphertext"])
        restored_engine = read_only_engine(restored)
        report = verify_restored_copy(restored_engine, manifest)
        assert report["status"] == STATUS_DISCREPANCY
        assert report["reappeared"] == [{"id": str(capture["id"]), "sha256_digest": digest}]
        assert report["global_verified_deletion"] is False

        # A copy that no longer holds the row is "no reappearance observed",
        # and the verdict still refuses to claim global deletion because
        # backups, WAL and off-site custody were never inspected.
        with create_engine(restored, hide_parameters=True).begin() as connection:
            connection.execute(text("DELETE FROM synthetic_capture_objects"))
        clean_engine = read_only_engine(restored)
        try:
            clean = verify_restored_copy(clean_engine, manifest)
        finally:
            clean_engine.dispose()
        assert clean["status"] == STATUS_NO_REAPPEARANCE
        assert clean["reappeared"] == []
        assert clean["global_verified_deletion"] is False

        # The active database is clean, yet the verdict still refuses to claim
        # global deletion because backups and WAL were not inspected.
        active_engine = read_only_engine(_admin_url())
        try:
            active = verify_restored_copy(active_engine, manifest)
        finally:
            active_engine.dispose()
        # The digest of the synthetic fixture is stable across tests, so the
        # active database is compared by identifier: the purged row is gone.
        assert str(capture["id"]) not in {entry["id"] for entry in active["reappeared"]}
        assert active["global_verified_deletion"] is False
    finally:
        if restored_engine is not None:
            restored_engine.dispose()
        _drop_isolated_database(server, name)


def test_verification_refuses_a_row_level_security_scoped_role(protected):
    _data_role_url()
    _client, _owner, _profile, _users = protected
    engine = read_only_engine(_data_role_url())
    try:
        with pytest.raises(RecoveryVerificationDenied):
            find_reappeared(engine, (PurgedCapture(uuid4(), "a" * 64),))
    finally:
        engine.dispose()


def test_other_tenant_valid_capture_survives_and_double_purge_is_idempotent(protected):
    _data_role_url()
    _client, owner, profile_id, users = protected
    outsider = users[2]
    image = _synthetic_png()
    expired_id, valid_id = uuid4(), uuid4()
    now = datetime.now(UTC)
    foreign_profile = None
    try:
        with owner.begin() as connection:
            foreign_profile = connection.execute(
                text(
                    "INSERT INTO profiles"
                    "(id,organization_id,display_code,birth_year,created_by) "
                    "VALUES (:id,:org,:code,1999,:actor) RETURNING id"
                ),
                {
                    "id": uuid4(),
                    "org": SECOND_WORKSPACE,
                    "code": "OTH-" + valid_id.hex[:10].upper(),
                    "actor": outsider[0],
                },
            ).scalar_one()
            rows = (
                # Retention bound: at most seven days between creation and expiry.
                (
                    expired_id,
                    FIRST_WORKSPACE,
                    profile_id,
                    users[0][0],
                    now - timedelta(days=8),
                    now - timedelta(days=1),
                ),
                (
                    valid_id,
                    SECOND_WORKSPACE,
                    foreign_profile,
                    outsider[0],
                    now,
                    now + timedelta(days=7),
                ),
            )
            for identifier, organization, profile, actor, created_at, expires_at in rows:
                connection.execute(
                    text(
                        "INSERT INTO synthetic_capture_objects("
                        "id,organization_id,profile_id,created_by,original_bytes,width,height,"
                        "sha256_digest,ciphertext,created_at,expires_at) VALUES ("
                        ":id,:org,:profile,:actor,:size,32,64,:digest,:ciphertext,"
                        ":created,:expires)"
                    ),
                    {
                        "id": identifier,
                        "org": organization,
                        "profile": profile,
                        "actor": actor,
                        "size": len(image),
                        "digest": hashlib.sha256(image).hexdigest(),
                        "ciphertext": Fernet(Fernet.generate_key()).encrypt(image),
                        "created": created_at,
                        "expires": expires_at,
                    },
                )

        assert _deleted_count(_run_worker()) == 1
        assert _capture_row(owner, expired_id) is None
        surviving = _capture_row(owner, valid_id)
        assert surviving is not None and bytes(surviving["ciphertext"])
        assert _deleted_count(_run_worker()) == 0
        assert _capture_row(owner, valid_id) is not None
    finally:
        # This extra fictional profile belongs to the test: the fixture teardown
        # must not inherit a dangling foreign key.
        if foreign_profile is not None:
            with owner.begin() as connection:
                connection.execute(
                    text("DELETE FROM synthetic_capture_objects WHERE profile_id=:id"),
                    {"id": foreign_profile},
                )
                connection.execute(
                    text("DELETE FROM profiles WHERE id=:id"), {"id": foreign_profile}
                )


def test_unreachable_restored_copy_fails_without_leaking_credentials():
    marker = "synthetic-only-secret"
    engine = read_only_engine(
        f"postgresql+psycopg://bodyvision_app:{marker}@127.0.0.1:1/bodyvision_restored"
    )
    try:
        with pytest.raises(RecoveryVerificationError) as caught:
            find_reappeared(engine, (PurgedCapture(uuid4(), "a" * 64),))
        assert marker not in str(caught.value)
        assert "postgresql+psycopg" not in str(caught.value)
    finally:
        engine.dispose()
