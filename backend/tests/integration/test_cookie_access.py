"""HttpOnly refresh cookie lifecycle in disposable synthetic PostgreSQL."""

import secrets

from pydantic import SecretStr
from sqlalchemy import text
from test_authenticated_api import PASSWORD, headers
from test_authenticated_api import protected as protected

from app.core.identity import hash_session_token
from app.services.cookie_access import REFRESH_COOKIE

ROOT = "/api/v1/auth/access"
CSRF = {"Origin": "http://testserver", "X-Requested-With": "XMLHttpRequest"}


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


def test_cookie_login_refresh_and_logout_are_revocation_aware(protected):
    client, owner, _, users = protected
    _enable(client)
    login = client.post(ROOT + "/login", headers=CSRF, json=_credentials(users[1]))
    assert login.status_code == 200, login.text
    raw_cookie = client.cookies.get(REFRESH_COOKIE)
    assert raw_cookie and len(raw_cookie) == 43
    assert raw_cookie not in login.text
    assert "token" not in login.json()
    assert login.json()["token_type"] == "Bearer"
    cookie_header = login.headers["set-cookie"]
    assert "httponly" in cookie_header.lower()
    assert "samesite=strict" in cookie_header.lower()
    assert "path=/api/v1/auth/access" in cookie_header.lower()

    first_jwt = login.json()["access_token"]
    old_digest = hash_session_token(raw_cookie)
    with owner.connect() as connection:
        expiry = connection.execute(
            text("SELECT expires_at FROM auth_sessions WHERE token_sha256=:digest"),
            {"digest": old_digest},
        ).scalar_one()
    assert client.get(ROOT + "/me", headers=headers(first_jwt)).status_code == 200

    refreshed = client.post(ROOT + "/refresh", headers=CSRF)
    assert refreshed.status_code == 200, refreshed.text
    next_cookie = client.cookies.get(REFRESH_COOKIE)
    assert next_cookie and next_cookie != raw_cookie
    assert next_cookie not in refreshed.text
    next_jwt = refreshed.json()["access_token"]
    assert next_jwt != first_jwt
    assert client.get(ROOT + "/me", headers=headers(first_jwt)).status_code == 401
    assert client.get(ROOT + "/me", headers=headers(next_jwt)).status_code == 200
    assert client.get("/api/v1/auth/me", headers=headers(raw_cookie)).status_code == 401
    assert client.get("/api/v1/auth/me", headers=headers(next_cookie)).status_code == 200

    with owner.connect() as connection:
        new_expiry = connection.execute(
            text("SELECT expires_at FROM auth_sessions WHERE token_sha256=:digest"),
            {"digest": hash_session_token(next_cookie)},
        ).scalar_one()
    assert new_expiry == expiry

    ended = client.post(ROOT + "/logout", headers=CSRF)
    assert ended.status_code == 204
    assert client.cookies.get(REFRESH_COOKIE) is None
    assert client.get(ROOT + "/me", headers=headers(next_jwt)).status_code == 401
    assert client.get("/api/v1/auth/me", headers=headers(next_cookie)).status_code == 401
    assert client.post(ROOT + "/refresh", headers=CSRF).status_code == 401


def test_cookie_mutations_are_csrf_guarded_and_disabled_without_flag(protected):
    client, _, _, users = protected
    credentials = _credentials(users[1])
    assert client.post(ROOT + "/login", headers=CSRF, json=credentials).status_code == 404
    _enable(client)

    for headers_in in (
        {},
        {"Origin": "http://testserver"},
        {"X-Requested-With": "XMLHttpRequest"},
        {"Origin": "https://external.invalid", "X-Requested-With": "XMLHttpRequest"},
    ):
        denied = client.post(ROOT + "/login", headers=headers_in, json=credentials)
        assert denied.status_code == 403
        assert denied.json()["code"] == "CSRF_REJECTED"
        assert client.cookies.get(REFRESH_COOKIE) is None

    login = client.post(ROOT + "/login", headers=CSRF, json=credentials)
    assert login.status_code == 200
    refresh_cookie = client.cookies.get(REFRESH_COOKIE)
    for path in ("/refresh", "/logout"):
        denied = client.post(ROOT + path, headers={"Origin": "https://other.invalid"})
        assert denied.status_code == 403
        assert client.cookies.get(REFRESH_COOKIE) == refresh_cookie
    assert client.post(ROOT + "/refresh", headers=CSRF).status_code == 200


def test_cookie_refresh_rejects_expired_database_session(protected):
    client, owner, _, users = protected
    _enable(client)
    response = client.post(ROOT + "/login", headers=CSRF, json=_credentials(users[1]))
    assert response.status_code == 200
    cookie = client.cookies.get(REFRESH_COOKIE)
    with owner.begin() as connection:
        connection.execute(
            text(
                "UPDATE auth_sessions SET expires_at=issued_at+interval '1 millisecond' "
                "WHERE token_sha256=:digest"
            ),
            {"digest": hash_session_token(cookie)},
        )
    assert client.post(ROOT + "/refresh", headers=CSRF).status_code == 401
