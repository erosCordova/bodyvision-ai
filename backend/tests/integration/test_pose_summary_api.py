from uuid import uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.exc import DBAPIError
from test_authenticated_api import authenticate, headers
from test_authenticated_api import protected as protected

BODY = dict(
    model_revision="pose_landmarker_lite/float16/1",
    detected=True,
    threshold=0.5,
    visible_points=25,
    core_visible=8,
    quality_state="reviewable",
    capture_passed=True,
    synthetic_confirmed=True,
)


@pytest.fixture
def pose_archive(protected):
    client, owner, profile, users = protected
    writer = headers(authenticate(client, users[0][0], users[0][1]).json()["token"])
    reader = headers(authenticate(client, users[1][0], users[1][1]).json()["token"])
    outsider = headers(authenticate(client, users[2][0], users[2][1]).json()["token"])
    root = f"/api/v1/profiles/{profile}/pose-summaries"
    try:
        yield client, owner, profile, writer, reader, outsider, root
    finally:
        with owner.begin() as conn:
            conn.execute(
                text("DELETE FROM synthetic_pose_summaries WHERE profile_id=:id"), {"id": profile}
            )
            conn.execute(
                text("DELETE FROM pose_summary_request_keys WHERE profile_id=:id"), {"id": profile}
            )


def accept(client, writer, profile, purpose):
    result = client.post(
        f"/api/v1/auth/profiles/{profile}/consents",
        headers=writer,
        json={"purpose": purpose, "version": "bv-synthetic-v1", "confirmed": True},
    )
    assert result.status_code == 200, result.text
    return next(
        row["id"]
        for row in result.json()["items"]
        if row["purpose"] == purpose and row["effective"]
    )


def test_pose_history_is_scoped_audited_and_idempotent(pose_archive):
    client, owner, profile, writer, reader, outsider, root = pose_archive
    key = str(uuid4())
    send = {**writer, "Idempotency-Key": key}
    assert client.get(root).status_code == 401
    assert client.post(root, headers=send, json=BODY).status_code == 403
    accept(client, writer, profile, "pose")
    assert client.post(root, headers=send, json=BODY).status_code == 403
    accept(client, writer, profile, "storage")
    result = client.post(root, headers=send, json=BODY)
    assert result.status_code == 201, result.text
    saved = result.json()
    assert saved["origin"] == "client_reported_browser"
    assert saved["data_type"] == "DERIVADO" and saved["synthetic"] is True
    assert len(saved["summary_sha256"]) == 64
    for forbidden in ("landmarks", "filename", "photo", "notes", "coordinates"):
        assert forbidden not in saved
    replay = client.post(root, headers=send, json=BODY)
    assert replay.status_code == 201 and replay.json()["id"] == saved["id"]
    assert client.post(root, headers=send, json={**BODY, "threshold": 0.6}).status_code == 409
    assert client.get(root, headers=reader).json()["total"] == 1
    assert client.get(root, headers=outsider).status_code == 404
    assert (
        client.post(
            root, headers={**reader, "Idempotency-Key": str(uuid4())}, json=BODY
        ).status_code
        == 403
    )
    assert client.delete(root + "/" + saved["id"], headers=reader).status_code == 403
    assert client.get(root + "?limit=0", headers=reader).status_code == 422
    assert (
        client.post(
            root,
            headers={**writer, "Idempotency-Key": str(uuid4())},
            json={**BODY, "photo": "forbidden"},
        ).status_code
        == 422
    )
    with owner.connect() as conn:
        assert (
            conn.execute(
                text("SELECT count(*) FROM measurements WHERE profile_id=:id"), {"id": profile}
            ).scalar_one()
            == 0
        )
        actions = (
            conn.execute(
                text("SELECT action FROM security_audit_events WHERE resource_id=:id"),
                {"id": profile},
            )
            .scalars()
            .all()
        )
        assert actions.count("pose.create") == 1 and "pose.list" in actions
    assert client.delete(root + "/" + saved["id"], headers=writer).status_code == 204
    assert client.get(root, headers=reader).json()["total"] == 0
    assert client.post(root, headers=send, json=BODY).status_code == 410


@pytest.mark.parametrize("purpose", ["pose", "storage"])
def test_revocation_erases_results_but_not_retry_tombstones(pose_archive, purpose):
    client, owner, profile, writer, reader, _, root = pose_archive
    consent_ids = {p: accept(client, writer, profile, p) for p in ("pose", "storage")}
    send = {**writer, "Idempotency-Key": str(uuid4())}
    assert client.post(root, headers=send, json=BODY).status_code == 201
    revoked = client.post(
        f"/api/v1/auth/profiles/{profile}/consents/{consent_ids[purpose]}/revoke", headers=writer
    )
    assert revoked.status_code == 200
    assert client.get(root, headers=reader).status_code == 403
    with owner.connect() as conn:
        assert (
            conn.execute(
                text("SELECT count(*) FROM synthetic_pose_summaries WHERE profile_id=:id"),
                {"id": profile},
            ).scalar_one()
            == 0
        )
        assert (
            conn.execute(
                text("SELECT count(*) FROM pose_summary_request_keys WHERE profile_id=:id"),
                {"id": profile},
            ).scalar_one()
            == 1
        )
    accept(client, writer, profile, purpose)
    assert client.get(root, headers=reader).json()["total"] == 0
    assert client.post(root, headers=send, json=BODY).status_code == 410


def test_audit_failure_rolls_back_summary_and_idempotency(pose_archive):
    client, owner, profile, writer, _, _, root = pose_archive
    for purpose in ("pose", "storage"):
        accept(client, writer, profile, purpose)

    def fail(conn, cursor, statement, parameters, context, executemany):
        if "audit_pose_summary" in statement:
            raise RuntimeError("Fictional audit failure")

    engine = client.app.state.engine
    event.listen(engine, "before_cursor_execute", fail)
    try:
        result = client.post(root, headers={**writer, "Idempotency-Key": str(uuid4())}, json=BODY)
        assert result.status_code == 500
    finally:
        event.remove(engine, "before_cursor_execute", fail)
    with owner.connect() as conn:
        for table in ("synthetic_pose_summaries", "pose_summary_request_keys"):
            assert (
                conn.execute(
                    text(f"SELECT count(*) FROM {table} WHERE profile_id=:id"), {"id": profile}
                ).scalar_one()
                == 0
            )


def test_sql_role_cannot_edit_or_read_without_verified_consent(pose_archive):
    client, owner, profile, writer, _, _, root = pose_archive
    for purpose in ("pose", "storage"):
        accept(client, writer, profile, purpose)
    result = client.post(root, headers={**writer, "Idempotency-Key": str(uuid4())}, json=BODY)
    identifier = result.json()["id"]
    with owner.connect() as conn:
        with conn.begin():
            conn.execute(text("SET LOCAL ROLE bodyvision_app"))
            assert (
                conn.execute(text("SELECT count(*) FROM synthetic_pose_summaries")).scalar_one()
                == 0
            )
            with pytest.raises(DBAPIError):
                conn.execute(
                    text("UPDATE synthetic_pose_summaries SET visible_points=1 WHERE id=:id"),
                    {"id": identifier},
                )


def test_paged_history_preserves_total_and_has_no_duplicate_rows(pose_archive):
    client, owner, profile, writer, reader, _, root = pose_archive
    for purpose in ("pose", "storage"):
        accept(client, writer, profile, purpose)
    with owner.begin() as conn:
        actor = conn.execute(
            text(
                "SELECT user_id FROM profile_access WHERE profile_id=:id AND access_level='manage'"
            ),
            {"id": profile},
        ).scalar_one()
        conn.execute(
            text("""INSERT INTO synthetic_pose_summaries
          (id,organization_id,profile_id,created_by,model_revision,algorithm_revision,
           detected,threshold,visible_points,core_visible,quality_state,capture_passed,summary_sha256)
          SELECT :id,p.organization_id,p.id,:actor,'pose_landmarker_lite/float16/1',
            'pose-review-summary-v1',false,.5,0,0,'not-detected',false,repeat('0',64)
          FROM profiles p WHERE p.id=:profile"""),
            [{"id": uuid4(), "actor": actor, "profile": profile} for _ in range(51)],
        )
    identifiers = []
    for offset, count in [(0, 20), (20, 20), (40, 11), (60, 0)]:
        result = client.get(root, headers=reader, params={"limit": 20, "offset": offset})
        assert result.status_code == 200
        body = result.json()
        assert body["total"] == 51 and len(body["items"]) == count
        identifiers.extend(row["id"] for row in body["items"])
    assert len(identifiers) == len(set(identifiers)) == 51


def test_expired_consent_blocks_reads_but_authorized_erasure_still_works(pose_archive):
    client, owner, profile, writer, reader, _, root = pose_archive
    for purpose in ("pose", "storage"):
        accept(client, writer, profile, purpose)
    saved = client.post(root, headers={**writer, "Idempotency-Key": str(uuid4())}, json=BODY).json()
    second_key = {**writer, "Idempotency-Key": str(uuid4())}
    second_body = {**BODY, "threshold": 0.6}
    assert client.post(root, headers=second_key, json=second_body).status_code == 201
    with owner.begin() as conn:
        conn.execute(
            text("""UPDATE profile_consents SET accepted_at=now()-interval '2 days',
            expires_at=now()-interval '1 day' WHERE profile_id=:id AND purpose='pose'"""),
            {"id": profile},
        )
    assert client.get(root, headers=reader).status_code == 403
    assert client.delete(root + "/" + saved["id"], headers=writer).status_code == 204
    with owner.connect() as conn:
        assert (
            conn.execute(
                text("SELECT count(*) FROM synthetic_pose_summaries WHERE profile_id=:id"),
                {"id": profile},
            ).scalar_one()
            == 1
        )
    accept(client, writer, profile, "pose")
    assert client.get(root, headers=reader).json()["total"] == 0
    assert client.post(root, headers=second_key, json=second_body).status_code == 410
    with owner.connect() as conn:
        assert (
            conn.execute(
                text("SELECT count(*) FROM synthetic_pose_summaries WHERE profile_id=:id"),
                {"id": profile},
            ).scalar_one()
            == 0
        )
