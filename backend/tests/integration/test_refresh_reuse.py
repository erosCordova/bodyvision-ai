"""Refresh-token family lineage and replay detection in disposable PostgreSQL.

Only a token consumed by rotation can be replayed: logout/password/administrative
revocation keep ``consumed_at`` null so those closed sessions never masquerade as
credential theft. A replay outside the concurrency grace window must revoke the
entire family, including the live replacement and its access JWT.
"""

import secrets

from pydantic import SecretStr
from sqlalchemy import text
from test_authenticated_api import PASSWORD
from test_authenticated_api import protected as protected

from app.core.identity import hash_session_token
from app.services.cookie_access import REFRESH_COOKIE

ROOT = "/api/v1/auth/access"
CSRF = {"Origin": "http://testserver", "X-Requested-With": "XMLHttpRequest"}
IDENTITY = "/api/v1/auth/access/me"


def _enable(client):
    client.app.state.settings = client.app.state.settings.model_copy(
        update={
            "jwt_access_enabled": True,
            "jwt_signing_key": SecretStr(secrets.token_urlsafe(32)),
        }
    )


def _credentials(user):
    return {
        "organization_id": str(user[1]),
        "email": f"fictional-{user[0].hex[:12]}@example.invalid",
        "password": PASSWORD,
    }


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


def _login(client, user):
    response = client.post(ROOT + "/login", headers=CSRF, json=_credentials(user))
    assert response.status_code == 200, response.text
    return client.cookies.get(REFRESH_COOKIE), response.json()["access_token"]


def _refresh(client):
    response = client.post(ROOT + "/refresh", headers=CSRF)
    assert response.status_code == 200, response.text
    return client.cookies.get(REFRESH_COOKIE), response.json()["access_token"]


def _replay(client, cookie_value):
    """Send one specific refresh cookie, bypassing the client's cookie jar."""
    request = client.build_request(
        "POST",
        ROOT + "/refresh",
        headers={**CSRF, "cookie": f"{REFRESH_COOKIE}={cookie_value}"},
    )
    return client.send(request)


def _digest(cookie_value):
    return hash_session_token(cookie_value)


def _session_row(owner, cookie_value):
    with owner.connect() as connection:
        return (
            connection.execute(
                text(
                    "SELECT id,family_id,parent_session_id,revoked_at,consumed_at "
                    "FROM auth_sessions WHERE token_sha256=CAST(:digest AS char(64))"
                ),
                {"digest": _digest(cookie_value)},
            )
            .mappings()
            .one()
        )


def _age_consumed_token(owner, cookie_value, *, seconds=60):
    """Move one consumed row past the grace window without breaking its checks."""
    with owner.begin() as connection:
        connection.execute(
            text(
                "UPDATE auth_sessions SET "
                "issued_at=clock_timestamp()-(CAST(:seconds AS integer)+60)*interval '1 second',"
                "consumed_at=clock_timestamp()-CAST(:seconds AS integer)*interval '1 second',"
                "revoked_at=clock_timestamp()-CAST(:seconds AS integer)*interval '1 second' "
                "WHERE token_sha256=CAST(:digest AS char(64))"
            ),
            {"seconds": seconds, "digest": _digest(cookie_value)},
        )


def _reuse_events(owner, organization_id, family_id):
    with owner.connect() as connection:
        return connection.execute(
            text(
                "SELECT action,resource_type,outcome,actor_id FROM security_audit_events "
                "WHERE organization_id=:org AND resource_type='session_family' "
                "AND resource_id=:family"
            ),
            {"org": organization_id, "family": family_id},
        ).all()


def _live_sessions(owner, family_id):
    with owner.connect() as connection:
        return connection.execute(
            text(
                "SELECT count(*) FROM auth_sessions WHERE family_id=:family AND revoked_at IS NULL"
            ),
            {"family": family_id},
        ).scalar_one()


def test_rotation_keeps_family_lineage_and_consumes_the_parent(protected):
    client, owner, _, users = protected
    _enable(client)
    first, _ = _login(client, users[1])
    second, second_access = _refresh(client)

    parent = _session_row(owner, first)
    child = _session_row(owner, second)
    assert parent["family_id"] == child["family_id"]
    assert child["parent_session_id"] == parent["id"]
    assert parent["revoked_at"] is not None and parent["consumed_at"] is not None
    assert child["revoked_at"] is None and child["consumed_at"] is None
    # The current replacement remains usable after one legitimate rotation.
    assert client.get(IDENTITY, headers=_bearer(second_access)).status_code == 200
    assert _live_sessions(owner, child["family_id"]) == 1


def test_replayed_refresh_token_revokes_its_whole_family(protected):
    client, owner, _, users = protected
    _enable(client)
    first, _ = _login(client, users[1])
    second, second_access = _refresh(client)
    family = _session_row(owner, second)["family_id"]
    assert client.get(IDENTITY, headers=_bearer(second_access)).status_code == 200

    _age_consumed_token(owner, first)
    replayed = _replay(client, first)

    assert replayed.status_code == 401
    assert replayed.json()["code"] == "SESSION_REUSE_DETECTED"
    assert "access_token" not in replayed.text
    assert first not in replayed.text and second not in replayed.text
    assert _digest(first) not in replayed.text and _digest(second) not in replayed.text
    assert "max-age=0" in replayed.headers["set-cookie"].lower()

    # The compromised family dies completely: successor cookie and JWT alike.
    assert client.get("/api/v1/auth/me", headers=_bearer(second)).status_code == 401
    revoked = client.get(IDENTITY, headers=_bearer(second_access))
    assert revoked.status_code == 401
    assert revoked.json()["code"] == "ACCESS_TOKEN_REVOKED"
    assert _live_sessions(owner, family) == 0
    assert _reuse_events(owner, users[1][1], family) == [
        ("auth.refresh_reuse_detected", "session_family", "denied", users[1][0])
    ]


def test_replay_inside_the_concurrency_grace_does_not_revoke_the_family(protected):
    client, owner, _, users = protected
    _enable(client)
    first, _ = _login(client, users[1])
    second, second_access = _refresh(client)
    family = _session_row(owner, second)["family_id"]

    replayed = _replay(client, first)

    assert replayed.status_code == 401
    assert replayed.json()["code"] == "SESSION_EXPIRED"
    assert client.get("/api/v1/auth/me", headers=_bearer(second)).status_code == 200
    assert client.get(IDENTITY, headers=_bearer(second_access)).status_code == 200
    assert _live_sessions(owner, family) == 1
    assert _reuse_events(owner, users[1][1], family) == []


def test_reuse_revokes_only_the_compromised_family(protected):
    client, owner, _, users = protected
    _enable(client)
    editor, outsider = users[0], users[2]

    first, _ = _login(client, editor)
    _, editor_access = _refresh(client)
    other_login, other_access = _login(client, editor)
    foreign_login, foreign_access = _login(client, outsider)
    compromised_family = _session_row(owner, first)["family_id"]
    other_family = _session_row(owner, other_login)["family_id"]
    assert compromised_family != other_family

    _age_consumed_token(owner, first)
    replayed = _replay(client, first)
    assert replayed.status_code == 401
    assert replayed.json()["code"] == "SESSION_REUSE_DETECTED"

    # Another login of the same user, another tenant and its JWT stay valid.
    assert client.get("/api/v1/auth/me", headers=_bearer(other_login)).status_code == 200
    assert client.get(IDENTITY, headers=_bearer(other_access)).status_code == 200
    assert client.get("/api/v1/auth/me", headers=_bearer(foreign_login)).status_code == 200
    assert client.get(IDENTITY, headers=_bearer(foreign_access)).status_code == 200
    assert client.get(IDENTITY, headers=_bearer(editor_access)).status_code == 401
    assert _live_sessions(owner, compromised_family) == 0
    assert _live_sessions(owner, other_family) == 1
    assert len(_reuse_events(owner, editor[1], compromised_family)) == 1
    assert _reuse_events(owner, editor[1], other_family) == []


def test_replay_of_a_logged_out_refresh_token_is_not_credential_theft(protected):
    client, owner, _, users = protected
    _enable(client)
    _, _ = _login(client, users[1])
    second, _ = _refresh(client)
    family = _session_row(owner, second)["family_id"]
    assert client.post(ROOT + "/logout", headers=CSRF).status_code == 204
    assert _session_row(owner, second)["consumed_at"] is None

    replayed = _replay(client, second)

    assert replayed.status_code == 401
    assert replayed.json()["code"] == "SESSION_EXPIRED"
    assert client.get("/api/v1/auth/me", headers=_bearer(second)).status_code == 401
    # No successor exists to protect, so no family-wide blame is recorded.
    assert _reuse_events(owner, users[1][1], family) == []
    assert _live_sessions(owner, family) == 0
