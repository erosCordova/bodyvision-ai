"""Session secret rotation against a disposable synthetic PostgreSQL database."""

from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from sqlalchemy import text

from app.core.identity import hash_session_token, issue_session_token
from test_authenticated_api import authenticate, headers
from test_authenticated_api import protected as protected

PATH = "/api/v1/auth/sessions/rotate"


def test_rotation_is_atomic_preserves_expiry_and_is_scoped(protected):
    client, owner, _, users = protected
    first = authenticate(client, *users[0][:2]).json()
    another = authenticate(client, *users[0][:2]).json()
    foreign = authenticate(client, *users[2][:2]).json()
    original = first["token"]

    response = client.post(PATH, headers=headers(original))
    assert response.status_code == 200, response.text
    rotated = response.json()
    assert rotated["token"] != original
    assert rotated["expires_at"] == first["expires_at"]
    assert rotated["organization_id"] == first["organization_id"]
    assert rotated["user_id"] == first["user_id"]
    assert rotated["role"] == first["role"]
    assert response.headers["Cache-Control"] == "no-store"

    assert client.get("/api/v1/auth/me", headers=headers(original)).status_code == 401
    assert client.get("/api/v1/auth/me", headers=headers(rotated["token"])).status_code == 200
    assert client.get("/api/v1/auth/me", headers=headers(another["token"])).status_code == 200
    assert client.get("/api/v1/auth/me", headers=headers(foreign["token"])).status_code == 200
    assert client.post(PATH, headers=headers(original)).status_code == 401
    sessions = client.get("/api/v1/auth/sessions", headers=headers(rotated["token"])).json()
    assert sessions["total"] == 2
    assert sum(item["current"] for item in sessions["items"]) == 1

    with owner.connect() as connection:
        events = connection.execute(
            text(
                "SELECT action,resource_type,outcome FROM security_audit_events "
                "WHERE organization_id=:org AND actor_id=:actor "
                "AND action='auth.session_rotated'"
            ),
            {"org": users[0][1], "actor": users[0][0]},
        ).all()
    assert events == [("auth.session_rotated", "session", "allowed")]
    assert original not in response.text


def test_rotation_rejects_unverified_and_untrusted_workspace(protected):
    client, _, _, users = protected
    token = authenticate(client, *users[1][:2]).json()["token"]
    assert client.post(PATH).status_code == 401
    assert client.post(PATH, headers=headers("A" * 43)).status_code == 401
    bad_workspace = client.post(
        PATH, headers={**headers(token), "X-Workspace-ID": str(uuid4())}
    )
    assert bad_workspace.status_code == 400
    assert client.get("/api/v1/auth/me", headers=headers(token)).status_code == 200


def test_rotation_preserves_verified_factor_timestamp(protected):
    client, owner, _, users = protected
    original = authenticate(client, *users[0][:2]).json()["token"]
    old_digest = hash_session_token(original)
    with owner.begin() as connection:
        previous_mfa = connection.execute(
            text(
                "UPDATE auth_sessions SET mfa_verified_at=now() "
                "WHERE token_sha256=CAST(:digest AS char(64)) RETURNING mfa_verified_at"
            ),
            {"digest": old_digest},
        ).scalar_one()
    rotated = client.post(PATH, headers=headers(original))
    assert rotated.status_code == 200, rotated.text
    new_digest = hash_session_token(rotated.json()["token"])
    with owner.connect() as connection:
        values = connection.execute(
            text(
                "SELECT token_sha256,mfa_verified_at,revoked_at FROM auth_sessions "
                "WHERE token_sha256 IN (CAST(:old AS char(64)),CAST(:new AS char(64)))"
            ),
            {"old": old_digest, "new": new_digest},
        ).all()
    by_digest = {row[0].strip(): row for row in values}
    assert by_digest[old_digest][2] is not None
    assert by_digest[new_digest][2] is None
    assert by_digest[new_digest][1] == previous_mfa


def test_concurrent_rotations_consume_token_once(protected):
    client, _, _, users = protected
    original = authenticate(client, *users[1][:2]).json()["token"]
    old_digest = hash_session_token(original)
    auth_engine = client.app.state.auth_engine

    def rotate_in_transaction(_):
        _, new_digest = issue_session_token()
        with auth_engine.begin() as connection:
            return connection.execute(
                text(
                    "SELECT private_rotate_session("
                    "CAST(:old AS char(64)),CAST(:new AS char(64)),:id,:event,:correlation)"
                ),
                {
                    "old": old_digest,
                    "new": new_digest,
                    "id": uuid4(),
                    "event": uuid4(),
                    "correlation": uuid4(),
                },
            ).scalar_one()["status"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(rotate_in_transaction, range(2)))
    assert sorted(statuses) == ["rotated", "unauthorized"]
    assert client.get("/api/v1/auth/me", headers=headers(original)).status_code == 401


def test_rotation_rolls_back_both_tokens_on_audit_failure(protected):
    client, owner, _, users = protected
    original = authenticate(client, *users[1][:2]).json()["token"]
    try:
        with owner.begin() as connection:
            connection.execute(
                text("""
                    CREATE FUNCTION test_rotation_audit_failure()
                    RETURNS trigger LANGUAGE plpgsql AS $$
                    BEGIN
                      IF NEW.action='auth.session_rotated' THEN
                        RAISE EXCEPTION 'Synthetic rotation audit failure';
                      END IF;
                      RETURN NEW;
                    END $$;
                    CREATE TRIGGER test_rotation_audit_failure
                    BEFORE INSERT ON security_audit_events
                    FOR EACH ROW EXECUTE FUNCTION test_rotation_audit_failure();
                """)
            )
        failed = client.post(PATH, headers=headers(original))
        assert failed.status_code == 500
        assert client.get("/api/v1/auth/me", headers=headers(original)).status_code == 200
        with owner.connect() as connection:
            count = connection.execute(
                text(
                    "SELECT count(*) FROM auth_sessions WHERE organization_id=:org "
                    "AND user_id=:actor AND revoked_at IS NULL"
                ),
                {"org": users[1][1], "actor": users[1][0]},
            ).scalar_one()
        assert count == 1
    finally:
        with owner.begin() as connection:
            connection.execute(
                text(
                    "DROP TRIGGER IF EXISTS test_rotation_audit_failure "
                    "ON security_audit_events; "
                    "DROP FUNCTION IF EXISTS test_rotation_audit_failure()"
                )
            )
