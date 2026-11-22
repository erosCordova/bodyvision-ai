"""Authoritative idle expiry and refresh inheritance on synthetic PostgreSQL."""

import secrets
from datetime import UTC, datetime, timedelta

from pydantic import SecretStr
from sqlalchemy import text
from test_authenticated_api import PASSWORD, authenticate, headers
from test_authenticated_api import protected as protected

from app.core.identity import hash_session_token
from app.services.cookie_access import REFRESH_COOKIE

ACTIVITY = "/api/v1/auth/activity"
REFRESH = "/api/v1/auth/access/refresh"
CSRF = {"Origin": "http://testserver", "X-Requested-With": "XMLHttpRequest"}


def test_activity_requires_verified_bearer_and_cannot_revive_idle_session(protected):
    client, owner, _, users = protected
    assert client.post(ACTIVITY).status_code == 401
    token = authenticate(client, *users[1][:2]).json()["token"]
    digest = hash_session_token(token)
    with owner.begin() as connection:
        connection.execute(
            text(
                "UPDATE auth_sessions SET last_activity_at=clock_timestamp()"
                "-interval '14 minutes' WHERE token_sha256=:digest"
            ),
            {"digest": digest},
        )
    activity = client.post(ACTIVITY, headers=headers(token))
    assert activity.status_code == 204, activity.text
    with owner.connect() as connection:
        touched = connection.execute(
            text("SELECT last_activity_at FROM auth_sessions WHERE token_sha256=:digest"),
            {"digest": digest},
        ).scalar_one()
    assert datetime.now(UTC) - touched < timedelta(seconds=15)
    assert client.get("/api/v1/auth/me", headers=headers(token)).status_code == 200

    with owner.begin() as connection:
        connection.execute(
            text(
                "UPDATE auth_sessions SET last_activity_at=clock_timestamp()"
                "-interval '16 minutes' WHERE token_sha256=:digest"
            ),
            {"digest": digest},
        )
    assert client.get("/api/v1/auth/me", headers=headers(token)).status_code == 401
    assert client.post(ACTIVITY, headers=headers(token)).status_code == 401
    assert client.post("/api/v1/auth/sessions/rotate", headers=headers(token)).status_code == 401


def test_idle_clock_survives_one_time_cookie_refresh_and_expires(protected):
    client, owner, _, users = protected
    client.app.state.settings = client.app.state.settings.model_copy(
        update={
            "jwt_access_enabled": True,
            "jwt_signing_key": SecretStr(secrets.token_urlsafe(32)),
        }
    )
    user = users[1]
    issued = client.post(
        "/api/v1/auth/access/login",
        headers=CSRF,
        json={
            "organization_id": str(user[1]),
            "email": f"fictional-{user[0].hex[:12]}@example.invalid",
            "password": PASSWORD,
        },
    )
    assert issued.status_code == 200, issued.text
    first_cookie = client.cookies.get(REFRESH_COOKIE)
    first_digest = hash_session_token(first_cookie)
    with owner.begin() as connection:
        connection.execute(
            text(
                "UPDATE auth_sessions SET last_activity_at=clock_timestamp()"
                "-interval '14 minutes' WHERE token_sha256=:digest"
            ),
            {"digest": first_digest},
        )
    refreshed = client.post(REFRESH, headers=CSRF)
    assert refreshed.status_code == 200, refreshed.text
    next_cookie = client.cookies.get(REFRESH_COOKIE)
    assert next_cookie != first_cookie
    next_digest = hash_session_token(next_cookie)
    with owner.connect() as connection:
        parent_activity = connection.execute(
            text("SELECT last_activity_at FROM auth_sessions WHERE token_sha256=:digest"),
            {"digest": first_digest},
        ).scalar_one()
        successor_activity = connection.execute(
            text("SELECT last_activity_at FROM auth_sessions WHERE token_sha256=:digest"),
            {"digest": next_digest},
        ).scalar_one()
    assert successor_activity == parent_activity
    assert datetime.now(UTC) - successor_activity > timedelta(minutes=13)

    # The rotation issued a fresh JWT, but it did not count as human activity.
    with owner.begin() as connection:
        connection.execute(
            text(
                "UPDATE auth_sessions SET last_activity_at=clock_timestamp()"
                "-interval '16 minutes' WHERE token_sha256=:digest"
            ),
            {"digest": next_digest},
        )
    assert client.post(REFRESH, headers=CSRF).status_code == 401
    assert client.get(
        "/api/v1/auth/access/me",
        headers=headers(refreshed.json()["access_token"]),
    ).status_code == 401


def test_jwt_bearer_activity_updates_exact_live_session(protected):
    client, owner, _, users = protected
    client.app.state.settings = client.app.state.settings.model_copy(
        update={
            "jwt_access_enabled": True,
            "jwt_signing_key": SecretStr(secrets.token_urlsafe(32)),
        }
    )
    opaque = authenticate(client, *users[0][:2]).json()["token"]
    jwt = client.post(
        "/api/v1/auth/access/exchange", headers=headers(opaque)
    ).json()["access_token"]
    assert client.post(ACTIVITY, headers=headers(jwt)).status_code == 204
    assert client.post(
        ACTIVITY,
        headers={**headers(jwt), "X-Workspace-ID": str(users[2][1])},
    ).status_code == 400
    with owner.begin() as connection:
        connection.execute(
            text(
                "UPDATE auth_sessions SET last_activity_at=clock_timestamp()"
                "-interval '20 minutes' WHERE token_sha256=:digest"
            ),
            {"digest": hash_session_token(opaque)},
        )
    assert client.post(ACTIVITY, headers=headers(jwt)).status_code == 401
