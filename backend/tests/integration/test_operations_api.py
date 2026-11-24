import json

from sqlalchemy import event
from sqlalchemy.exc import OperationalError
from test_authenticated_api import authenticate, headers
from test_authenticated_api import protected as protected

from app.models.context import FIRST_WORKSPACE, SECOND_WORKSPACE


def test_operations_require_admin_and_never_mix_organizations(protected):
    client, _, profile, users = protected
    editor, member, outsider, administrator = users
    root = "/api/v1/auth/operations"
    assert client.get(root).status_code == 401
    for user in (editor, member):
        session = headers(authenticate(client, user[0], user[1]).json()["token"])
        assert client.get(root, headers=session).status_code == 403
    admin = headers(authenticate(client, administrator[0], administrator[1]).json()["token"])
    # A second tenant's private traffic must not enter this administrator's view.
    private = headers(authenticate(client, outsider[0], outsider[1]).json()["token"])
    assert client.get("/api/v1/workspaces", headers=private).status_code == 200
    metrics = client.app.state.operations
    metrics.observe(SECOND_WORKSPACE, 500, 3000, interrupted=True)
    own_count = metrics.snapshot(FIRST_WORKSPACE)["sample_count"]
    response = client.get(root, headers=admin)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["sample_count"] == own_count
    assert body["query_interruptions"] == 0
    assert body["database"]["state"] == "ready"
    assert body["retention"]["state"] == "disabled"
    assert body["scope"] == "current_organization_current_process"
    assert client.get(root, headers=admin).json()["sample_count"] == own_count
    for value in (
        str(FIRST_WORKSPACE),
        str(SECOND_WORKSPACE),
        str(profile),
        admin["Authorization"],
        "postgresql",
        "ciphertext",
        "actor_id",
        "display_name",
    ):
        assert value not in json.dumps(body)
    assert response.headers["cache-control"] == "no-store"
    assert (
        client.get(root, headers={**admin, "X-Workspace-ID": str(SECOND_WORKSPACE)}).status_code
        == 400
    )
    # Role/session changes remain effective on the very next diagnostics read.
    assert client.post("/api/v1/auth/logout", headers=admin).status_code == 204
    assert client.get(root, headers=admin).status_code == 401


def test_database_probe_failures_are_safe_and_recoverable(protected):
    client, _, _, users = protected
    admin = headers(authenticate(client, users[3][0], users[3][1]).json()["token"])
    engine = client.app.state.engine

    def unavailable(conn, cursor, statement, parameters, context, executemany):
        if "system_schema_state" in statement:
            raise OperationalError("private SQL", {}, Exception("private database password"))

    event.listen(engine, "before_cursor_execute", unavailable)
    try:
        result = client.get("/api/v1/auth/operations", headers=admin)
        assert result.status_code == 200
        assert result.json()["database"]["state"] == "unavailable"
        assert "database_unavailable" in result.json()["alerts"]
        assert "private" not in result.text and "password" not in result.text
    finally:
        event.remove(engine, "before_cursor_execute", unavailable)
    assert (
        client.get("/api/v1/auth/operations", headers=admin).json()["database"]["state"] == "ready"
    )


def test_verified_request_timeout_is_observed_without_raw_sql(protected):
    client, _, _, users = protected
    editor = headers(authenticate(client, users[0][0], users[0][1]).json()["token"])
    admin = headers(authenticate(client, users[3][0], users[3][1]).json()["token"])
    engine = client.app.state.engine

    class QueryTimeout(Exception):
        sqlstate = "57014"

    def timeout(conn, cursor, statement, parameters, context, executemany):
        if "FROM metric_catalog" in statement:
            raise OperationalError("sensitive SQL", {}, QueryTimeout("sensitive exception"))

    event.listen(engine, "before_cursor_execute", timeout)
    try:
        assert client.get("/api/v1/metrics/catalog", headers=editor).status_code == 500
    finally:
        event.remove(engine, "before_cursor_execute", timeout)
    body = client.get("/api/v1/auth/operations", headers=admin).json()
    assert body["server_errors"] == 1 and body["query_interruptions"] == 1
    assert "query_interrupted" in body["alerts"]
    assert "sensitive" not in json.dumps(body)
    assert "57014" not in json.dumps(body)


def test_capture_inventory_is_admin_only_rls_scoped_and_read_only(protected):
    import hashlib
    from uuid import uuid4

    from cryptography.fernet import Fernet
    from sqlalchemy import text
    from test_authenticated_api import _synthetic_png

    client, owner, profile, users = protected
    editor, member, outsider, administrator = users
    endpoint = "/api/v1/auth/captures/retention-inventory"
    assert client.get(endpoint).status_code == 401
    for person in (editor, member, outsider):
        bearer = headers(authenticate(client, person[0], person[1]).json()["token"])
        assert client.get(endpoint, headers=bearer).status_code == 403
    admin = headers(authenticate(client, administrator[0], administrator[1]).json()["token"])
    image = _synthetic_png()
    encrypted = Fernet(Fernet.generate_key()).encrypt(image)
    expired, current = uuid4(), uuid4()
    with owner.begin() as connection:
        for identifier, is_expired in ((expired, True), (current, False)):
            connection.execute(
                text("""
                    INSERT INTO synthetic_capture_objects(
                      id,organization_id,profile_id,created_by,original_bytes,
                      width,height,sha256_digest,ciphertext,created_at,expires_at
                    ) VALUES(
                      :id,:org,:profile,:actor,:bytes,32,64,:digest,:cipher,
                      CASE WHEN :expired THEN now()-interval '8 days' ELSE now() END,
                      CASE WHEN :expired THEN now()-interval '1 day'
                           ELSE now()+interval '7 days' END
                    )
                """),
                {
                    "id": identifier,
                    "org": FIRST_WORKSPACE,
                    "profile": profile,
                    "actor": editor[0],
                    "bytes": len(image),
                    "digest": hashlib.sha256(image).hexdigest(),
                    "cipher": encrypted,
                    "expired": is_expired,
                },
            )
    # An administrator without a profile grant sees only their own empty
    # RLS scope, not the expired record of another authorized user.
    no_grant = client.get(endpoint, headers=admin)
    assert no_grant.status_code == 200, no_grant.text
    assert no_grant.json()["expired_count"] == 0
    assert no_grant.json()["scope"] == "current_organization_accessible_profiles_only"
    with owner.begin() as connection:
        connection.execute(
            text("""
                INSERT INTO profile_access(id,organization_id,profile_id,user_id,access_level)
                VALUES(:id,:org,:profile,:actor,'read')
            """),
            {"id": uuid4(), "org": FIRST_WORKSPACE, "profile": profile, "actor": administrator[0]},
        )
    response = client.get(endpoint, headers=admin)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["expired_count"] == 1
    assert body["count_capped"] is False
    assert body["display_limit"] == 1000
    assert body["oldest_expired_at"] is not None
    assert body["purge_executed"] is False
    assert "no-store" in response.headers["cache-control"]
    assert (
        client.get(
            endpoint,
            headers={**admin, "X-Workspace-ID": str(SECOND_WORKSPACE)},
        ).status_code
        == 400
    )
    for sensitive in (
        str(FIRST_WORKSPACE),
        str(SECOND_WORKSPACE),
        str(profile),
        str(expired),
        str(current),
        str(editor[0]),
        admin["Authorization"],
        "ciphertext",
        "password",
    ):
        assert sensitive not in response.text
    with owner.connect() as connection:
        assert (
            connection.execute(
                text("SELECT count(*) FROM synthetic_capture_objects WHERE profile_id=:id"),
                {"id": profile},
            ).scalar_one()
            == 2
        )
    # Losing the only grant immediately removes the observation.
    with owner.begin() as connection:
        connection.execute(
            text("DELETE FROM profile_access WHERE profile_id=:profile AND user_id=:actor"),
            {"profile": profile, "actor": administrator[0]},
        )
    assert client.get(endpoint, headers=admin).json()["expired_count"] == 0
    assert client.post("/api/v1/auth/logout", headers=admin).status_code == 204
    assert client.get(endpoint, headers=admin).status_code == 401


def test_capture_inventory_cap_and_zero_do_not_claim_global_retention():
    from datetime import UTC, datetime

    from app.api.routes.operations import describe_capture_retention

    now = datetime(2026, 11, 21, tzinfo=UTC)
    full = describe_capture_retention(1001, now, now)
    assert full.expired_count == 1000 and full.count_capped is True
    assert full.purge_executed is False
    assert full.scope == "current_organization_accessible_profiles_only"
    empty = describe_capture_retention(0, now, now)
    assert empty.expired_count == 0 and empty.oldest_expired_at is None
    assert empty.count_capped is False
