"""JWT exchange regression tests against disposable private PostgreSQL fixtures."""

import secrets

from pydantic import SecretStr
from sqlalchemy import text
from test_authenticated_api import authenticate, headers
from test_authenticated_api import protected as protected

from app.core.identity import hash_session_token

EXCHANGE = "/api/v1/auth/access/exchange"
IDENTITY = "/api/v1/auth/access/me"


def _enable(client):
    secret = secrets.token_urlsafe(32)
    client.app.state.settings = client.app.state.settings.model_copy(
        update={"jwt_access_enabled": True, "jwt_signing_key": SecretStr(secret)}
    )


def test_jwt_is_opt_in_and_exchanges_only_authenticated_session(protected):
    client, _, _, users = protected
    opaque = authenticate(client, *users[1][:2]).json()["token"]
    assert client.post(EXCHANGE, headers=headers(opaque)).status_code == 404
    assert client.get(IDENTITY, headers=headers(opaque)).status_code == 404
    _enable(client)

    assert client.post(EXCHANGE).status_code == 401
    assert client.post(EXCHANGE, headers=headers("A" * 43)).status_code == 401
    exchanged = client.post(EXCHANGE, headers=headers(opaque))
    assert exchanged.status_code == 200, exchanged.text
    body = exchanged.json()
    assert body["token_type"] == "Bearer"
    assert body["role"] == users[1][2]
    assert body["user_id"] == str(users[1][0])
    assert body["organization_id"] == str(users[1][1])
    assert opaque not in exchanged.text
    assert hash_session_token(opaque) not in exchanged.text
    jwt = body["access_token"]
    assert len(jwt.split(".")) == 3

    validated = client.get(IDENTITY, headers=headers(jwt))
    assert validated.status_code == 200, validated.text
    assert validated.json() == {
        "user_id": str(users[1][0]),
        "organization_id": str(users[1][1]),
        "role": users[1][2],
    }
    assert validated.headers["Cache-Control"] == "no-store"
    assert client.get(IDENTITY, headers=headers(opaque)).status_code == 401
    assert client.get("/api/v1/auth/me", headers=headers(jwt)).status_code == 200


def test_jwt_respects_immediate_logout_revocation(protected):
    client, _, _, users = protected
    _enable(client)
    opaque = authenticate(client, *users[0][:2]).json()["token"]
    jwt = client.post(EXCHANGE, headers=headers(opaque)).json()["access_token"]
    assert client.get(IDENTITY, headers=headers(jwt)).status_code == 200
    assert client.post("/api/v1/auth/logout", headers=headers(opaque)).status_code == 204
    revoked = client.get(IDENTITY, headers=headers(jwt))
    assert revoked.status_code == 401
    assert revoked.json()["code"] == "ACCESS_TOKEN_REVOKED"


def test_jwt_rejects_role_change_invalid_header_and_wrong_tenant(protected):
    client, owner, _, users = protected
    _enable(client)
    original = authenticate(client, *users[0][:2]).json()["token"]
    jwt = client.post(EXCHANGE, headers=headers(original)).json()["access_token"]
    assert client.get(IDENTITY, headers=headers(jwt)).status_code == 200
    assert client.get(IDENTITY, headers=headers(jwt[:-1] + "=")).status_code == 401
    spoofed = {**headers(jwt), "X-Workspace-ID": str(users[2][1])}
    assert client.get(IDENTITY, headers=spoofed).status_code == 400
    with owner.begin() as connection:
        connection.execute(
            text(
                "UPDATE user_role_assignments SET role='member' "
                "WHERE organization_id=:org AND user_id=:id"
            ),
            {"org": users[0][1], "id": users[0][0]},
        )
    updated = client.get(IDENTITY, headers=headers(jwt))
    assert updated.status_code == 401
    assert updated.json()["code"] == "ACCESS_TOKEN_REVOKED"


def test_jwt_does_not_bypass_new_mfa_enforcement(protected):
    client, _, _, users = protected
    _enable(client)
    specialist = authenticate(client, *users[0][:2]).json()["token"]
    member = authenticate(client, *users[1][:2]).json()["token"]
    professional_jwt = client.post(EXCHANGE, headers=headers(specialist)).json()["access_token"]
    member_jwt = client.post(EXCHANGE, headers=headers(member)).json()["access_token"]
    client.app.state.settings = client.app.state.settings.model_copy(update={"mfa_enabled": True})
    assert client.get(IDENTITY, headers=headers(professional_jwt)).status_code == 401
    assert client.get(IDENTITY, headers=headers(member_jwt)).status_code == 200


def test_jwt_authorizes_private_workspace_with_existing_rls_and_revocation(protected):
    client, owner, profile, users = protected
    _enable(client)
    editor, member, outsider = users[:3]
    tokens = {}
    for actor in (editor, member, outsider):
        opaque = authenticate(client, *actor[:2]).json()["token"]
        jwt = client.post(EXCHANGE, headers=headers(opaque))
        assert jwt.status_code == 200, jwt.text
        tokens[actor[2] + str(actor[0])] = (opaque, jwt.json()["access_token"])
    editor_opaque, editor_jwt = tokens[editor[2] + str(editor[0])]
    _, member_jwt = tokens[member[2] + str(member[0])]
    _, outsider_jwt = tokens[outsider[2] + str(outsider[0])]
    path = f"/api/v1/profiles/{profile}"

    assert client.get(path, headers=headers(editor_jwt)).status_code == 200
    assert client.get(path, headers=headers(member_jwt)).status_code == 200
    assert client.get(path, headers=headers(outsider_jwt)).status_code == 404
    assert client.get("/api/v1/workspaces", headers=headers(editor_jwt)).json()["items"] == [
        {"id": str(editor[1]), "name": "Centro Horizonte (ficticio)"}
    ]
    assert (
        client.patch(
            path, headers=headers(member_jwt), json={"display_name": "Forbidden"}
        ).status_code
        == 403
    )
    corrected = client.patch(
        path, headers=headers(editor_jwt), json={"display_name": "Corrección ficticia"}
    )
    assert corrected.status_code == 200, corrected.text
    assert (
        client.get(
            path, headers={**headers(editor_jwt), "X-Workspace-ID": str(outsider[1])}
        ).status_code
        == 400
    )

    with owner.begin() as connection:
        connection.execute(
            text("DELETE FROM profile_access WHERE profile_id=:profile AND user_id=:actor"),
            {"profile": profile, "actor": editor[0]},
        )
    assert client.get(path, headers=headers(editor_jwt)).status_code == 404
    assert client.post("/api/v1/auth/logout", headers=headers(editor_opaque)).status_code == 204
    assert client.get(path, headers=headers(editor_jwt)).status_code == 401


def test_jwt_supports_tenant_scoped_admin_and_consent_endpoints(protected):
    client, _, profile, users = protected
    _enable(client)
    admin = authenticate(client, *users[3][:2]).json()["token"]
    specialist = authenticate(client, *users[0][:2]).json()["token"]
    admin_jwt = client.post(EXCHANGE, headers=headers(admin)).json()["access_token"]
    editor_jwt = client.post(EXCHANGE, headers=headers(specialist)).json()["access_token"]

    own = client.get("/api/v1/auth/users", headers=headers(admin_jwt))
    assert own.status_code == 200, own.text
    assert own.json()["total"] >= 3
    denied = client.get("/api/v1/auth/users", headers=headers(editor_jwt))
    assert denied.status_code == 403
    audit = client.get("/api/v1/auth/audit", headers=headers(admin_jwt))
    assert audit.status_code == 200, audit.text

    consent = client.get(f"/api/v1/auth/profiles/{profile}/consents", headers=headers(editor_jwt))
    assert consent.status_code == 200, consent.text
    sessions = client.get("/api/v1/auth/sessions", headers=headers(editor_jwt))
    assert sessions.status_code == 200, sessions.text
    assert sessions.json()["total"] == 1

    assert client.post("/api/v1/auth/logout", headers=headers(specialist)).status_code == 204
    assert client.get("/api/v1/auth/sessions", headers=headers(editor_jwt)).status_code == 401
