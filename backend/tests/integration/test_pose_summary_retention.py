"""Physical cleanup of fictional pose summaries after consent expiry.

This verifies SQL authorization, bounded deletion, and retained retry tombstones.
All fixtures are synthetic and run only against disposable test PostgreSQL.
"""

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from test_pose_summary_api import BODY, accept, pose_archive as pose_archive

from app.workers.capture_retention import purge_due_pose_summaries


def test_expired_pose_consent_is_purged_but_valid_summary_remains(pose_archive):
    client, owner, profile, writer, reader, _, root = pose_archive
    for purpose in ("pose", "storage"):
        accept(client, writer, profile, purpose)
    key = str(uuid4())
    result = client.post(root, headers={**writer, "Idempotency-Key": key}, json=BODY)
    assert result.status_code == 201, result.text
    identifier = result.json()["id"]
    with owner.begin() as connection:
        connection.execute(text("SET LOCAL ROLE bodyvision_app"))
        assert connection.execute(
            text("SELECT purge_expired_pose_summary_batch(10)")
        ).scalar_one() == 0
    assert client.get(root, headers=reader).json()["total"] == 1

    with owner.begin() as connection:
        connection.execute(
            text("""UPDATE profile_consents SET expires_at=now()-interval '1 minute',
                accepted_at=now()-interval '2 days'
                WHERE profile_id=:profile AND purpose='pose'"""),
            {"profile": profile},
        )
    assert purge_due_pose_summaries(client.app.state.engine) == 1
    assert purge_due_pose_summaries(client.app.state.engine) == 0
    with owner.connect() as connection:
        assert connection.execute(
            text("SELECT count(*) FROM synthetic_pose_summaries WHERE id=:id"),
            {"id": identifier},
        ).scalar_one() == 0
        assert connection.execute(
            text("SELECT count(*) FROM pose_summary_request_keys WHERE result_id=:id"),
            {"id": identifier},
        ).scalar_one() == 1
    accept(client, writer, profile, "pose")
    assert client.post(
        root, headers={**writer, "Idempotency-Key": key}, json=BODY
    ).status_code == 410


def test_pose_retention_rejects_unbounded_batches(pose_archive):
    _, owner, _, _, _, _, _ = pose_archive
    for invalid in (0, 101):
        with pytest.raises(DBAPIError):
            with owner.begin() as connection:
                connection.execute(text("SET LOCAL ROLE bodyvision_app"))
                connection.execute(
                    text("SELECT purge_expired_pose_summary_batch(:limit)"), {"limit": invalid}
                )
