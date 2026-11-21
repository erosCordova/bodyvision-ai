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
