"""Independent data-role cleanup without a web request, using synthetic PostgreSQL."""

import hashlib
import os
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import text
from sqlalchemy.engine import make_url
from test_authenticated_api import _synthetic_png
from test_authenticated_api import protected as protected

from app.models.context import FIRST_WORKSPACE
from app.workers.independent_capture_retention import run_once


def test_offline_worker_purges_expired_captures_and_leaves_valid_ciphertext(protected):
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        pytest.skip("Requires local data-role PostgreSQL")
    parsed = make_url(url)
    if parsed.username != "bodyvision_app" or parsed.host not in {
        "localhost", "127.0.0.1", "::1",
    }:
        pytest.skip("Offline positive test runs on the native loopback runner")

    _client, owner, profile_id, users = protected
    png = _synthetic_png()
    encrypted = Fernet(Fernet.generate_key()).encrypt(png)
    digest = hashlib.sha256(png).hexdigest()
    expired_id, valid_id = uuid4(), uuid4()
    with owner.begin() as connection:
        for identity, expired in ((expired_id, True), (valid_id, False)):
            connection.execute(
                text("""
                    INSERT INTO synthetic_capture_objects(
                      id,organization_id,profile_id,created_by,original_bytes,
                      width,height,sha256_digest,ciphertext,created_at,expires_at
                    ) VALUES (
                      :id,:org,:profile,:actor,:size,32,64,:digest,:encrypted,
                      CASE WHEN :expired THEN now()-interval '8 days' ELSE now() END,
                      CASE WHEN :expired THEN now()-interval '1 day'
                           ELSE now()+interval '7 days' END
                    )
                """),
                {
                    "id": identity,
                    "org": FIRST_WORKSPACE,
                    "profile": profile_id,
                    "actor": users[0][0],
                    "size": len(png),
                    "digest": digest,
                    "encrypted": encrypted,
                    "expired": expired,
                },
            )

    # The new module creates its own limited DB connection. No ASGI service,
    # HTTP endpoint, authentication token or envelope decryption is involved.
    environment = {
        "APP_ENV": "test",
        "IDENTITY_ENABLED": "true",
        "BODYVISION_ENABLE_CAPTURE_RETENTION": "synthetic-only",
        "DATABASE_URL": url,
    }
    assert run_once(environment) == 1
    assert run_once(environment) == 0
    with owner.connect() as connection:
        rows = connection.execute(
            text("SELECT id,ciphertext FROM synthetic_capture_objects WHERE profile_id=:profile"),
            {"profile": profile_id},
        ).mappings().all()
        assert len(rows) == 1
        assert rows[0]["id"] == valid_id
        assert bytes(rows[0]["ciphertext"]) == encrypted
        events = connection.execute(
            text(
                "SELECT count(*) FROM synthetic_capture_maintenance_events "
                "WHERE action='retention.purge' AND deleted_count=1"
            )
        ).scalar_one()
        assert events >= 1
