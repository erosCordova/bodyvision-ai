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
    assert client.get("/api/v1/auth/me", headers=headers(jwt)).status_code == 401


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
    assert client.get(IDENTITY, headers={**headers(jwt), "X-Workspace-ID": str(users[2][1])}).status_code == 400
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
    professional_jwt = client.post(EXCHANGE, headers=headers(specialist)).json()[
        "access_token"
    ]
    member_jwt = client.post(EXCHANGE, headers=headers(member)).json()["access_token"]
    client.app.state.settings = client.app.state.settings.model_copy(update={"mfa_enabled": True})
    assert client.get(IDENTITY, headers=headers(professional_jwt)).status_code == 401
    assert client.get(IDENTITY, headers=headers(member_jwt)).status_code == 200
