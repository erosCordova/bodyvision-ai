"""Opt-in authenticated API behaviour on disposable synthetic PostgreSQL only."""

import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text

from app.core.config import Settings
from app.core.identity import hash_password, hash_session_token, login_bucket_digest
from app.main import create_app
from app.models.context import FIRST_WORKSPACE, SECOND_WORKSPACE

PASSWORD = "Synthetic test passphrase 2026!"


@pytest.fixture
def protected():
    admin_url = os.environ.get("TEST_DATABASE_URL")
    auth_url = os.environ.get("AUTH_DATABASE_URL")
    if not admin_url or not auth_url:
        pytest.skip("Private login integration requires disposable PostgreSQL and auth DB role")

    owner = create_engine(admin_url, hide_parameters=True)
    app_engine = create_engine(admin_url, hide_parameters=True)

    @event.listens_for(app_engine, "connect")
    def use_app_role(connection, record):
        connection.execute("SET ROLE bodyvision_app")

    profile_id = uuid4()
    editor_id, reader_id, outsider_id = uuid4(), uuid4(), uuid4()
    users = [
        (editor_id, FIRST_WORKSPACE, "specialist", "manage"),
        (reader_id, FIRST_WORKSPACE, "member", "read"),
        (outsider_id, SECOND_WORKSPACE, "specialist", None),
    ]
    try:
        with owner.begin() as conn:
            for user_id, organization, role, _ in users:
                conn.execute(
                    text("""
                        INSERT INTO users
                          (id,organization_id,display_name,email,password_hash,
                           is_local_operator,account_status)
                        VALUES (:id,:org,'Persona ficticia',:email,:hash,false,'active')
                    """),
                    {
                        "id": user_id,
                        "org": organization,
                        "email": f"fictional-{user_id.hex[:12]}@example.invalid",
                        "hash": hash_password(PASSWORD),
                    },
                )
                conn.execute(
                    text("""
                        INSERT INTO user_role_assignments(id,organization_id,user_id,role)
                        VALUES (:id,:org,:user,:role)
                    """),
                    {"id": uuid4(), "org": organization, "user": user_id, "role": role},
                )

            actor = conn.execute(
                text("""
                    SELECT id FROM users WHERE organization_id=:org AND is_local_operator
                """),
                {"org": FIRST_WORKSPACE},
            ).scalar_one()
            conn.execute(
                text("""
                    INSERT INTO profiles(id,organization_id,display_code,birth_year,created_by)
                    VALUES (:id,:org,:code,1999,:actor)
                """),
                {
                    "id": profile_id,
                    "org": FIRST_WORKSPACE,
                    "code": "SEC-" + profile_id.hex[:10].upper(),
                    "actor": actor,
                },
            )
            for user_id, organization, _, grant in users:
                if grant:
                    conn.execute(
                        text("""
                            INSERT INTO profile_access(
                                id,organization_id,profile_id,user_id,access_level
                            ) VALUES (:id,:org,:profile,:user,:grant)
                        """),
                        {
                            "id": uuid4(),
                            "org": organization,
                            "profile": profile_id,
                            "user": user_id,
                            "grant": grant,
                        },
                    )
        settings = Settings(
            app_env="test",
            database_url=admin_url,
            auth_database_url=auth_url,
            identity_enabled=True,
        )
        with TestClient(create_app(settings, app_engine)) as client:
            yield client, owner, profile_id, users
    finally:
        with owner.begin() as conn:
            conn.execute(
                text("DELETE FROM auth_login_attempts WHERE organization_id IN (:a,:b)"),
                {"a": FIRST_WORKSPACE, "b": SECOND_WORKSPACE},
            )
            conn.execute(
                text("DELETE FROM auth_sessions WHERE user_id = ANY(:ids)"),
                {"ids": [x[0] for x in users]},
            )
            conn.execute(
                text("DELETE FROM profile_access WHERE profile_id=:id"), {"id": profile_id}
            )
            conn.execute(text("DELETE FROM profiles WHERE id=:id"), {"id": profile_id})
            conn.execute(
                text("DELETE FROM user_role_assignments WHERE user_id = ANY(:ids)"),
                {"ids": [x[0] for x in users]},
            )
            conn.execute(
                text("DELETE FROM users WHERE id = ANY(:ids)"),
                {"ids": [x[0] for x in users]},
            )
        app_engine.dispose()
        owner.dispose()


def authenticate(client: TestClient, user_id, org):
    return client.post(
        "/api/v1/auth/login",
        json={
            "organization_id": str(org),
            "email": f"fictional-{user_id.hex[:12]}@example.invalid",
            "password": PASSWORD,
        },
    )


def headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_login_requires_real_credentials_and_ignores_untrusted_tenant_selector(protected):
    client, _, profile, users = protected
    editor, reader, outsider = users
    path = "/api/v1/profiles/" + str(profile)
    assert client.get(path).status_code == 401
    login = authenticate(client, editor[0], editor[1])
    assert login.status_code == 200, login.text
    session = login.json()
    token = session["token"]
    assert len(token) >= 40
    me = client.get("/api/v1/auth/me", headers=headers(token))
    assert me.status_code == 200
    assert me.json()["organization_id"] == str(FIRST_WORKSPACE)
    assert me.json()["user_id"] == str(editor[0])
    assert me.json()["role"] == "specialist"

    assert client.get(path, headers=headers(token)).status_code == 200
    forbidden = client.get(
        path,
        headers={**headers(token), "X-Workspace-ID": str(SECOND_WORKSPACE)},
    )
    assert forbidden.status_code == 400
    assert client.get(path, headers={"X-Workspace-ID": str(FIRST_WORKSPACE)}).status_code == 401
    assert client.get("/api/v1/workspaces", headers=headers(token)).json()["items"] == [
        {"id": str(FIRST_WORKSPACE), "name": "Centro Horizonte (ficticio)"}
    ]

    wrong_password = client.post(
        "/api/v1/auth/login",
        json={
            "organization_id": str(FIRST_WORKSPACE),
            "email": f"fictional-{editor[0].hex[:12]}@example.invalid",
            "password": "wrong password",
        },
    )
    unknown_email = client.post(
        "/api/v1/auth/login",
        json={
            "organization_id": str(FIRST_WORKSPACE),
            "email": "unknown@example.invalid",
            "password": "wrong password",
        },
    )
    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json()["code"] == unknown_email.json()["code"]
    assert authenticate(client, outsider[0], FIRST_WORKSPACE).status_code == 401


def test_authorization_revocation_and_session_expiry(protected):
    client, owner, profile, users = protected
    editor, reader, outsider = users
    path = "/api/v1/profiles/" + str(profile)

    editor_token = authenticate(client, editor[0], editor[1]).json()["token"]
    member_token = authenticate(client, reader[0], reader[1]).json()["token"]
    outside_token = authenticate(client, outsider[0], outsider[1]).json()["token"]
    assert client.get(path, headers=headers(member_token)).status_code == 200
    assert (
        client.patch(
            path, headers=headers(member_token), json={"display_name": "No permitido"}
        ).status_code
        == 403
    )
    assert client.get(path, headers=headers(outside_token)).status_code == 404
    assert (
        client.patch(
            path, headers=headers(editor_token), json={"display_name": "Ficticio seguro"}
        ).status_code
        == 200
    )

    assert client.post("/api/v1/auth/logout", headers=headers(editor_token)).status_code == 204
    assert client.get(path, headers=headers(editor_token)).status_code == 401

    with owner.begin() as conn:
        conn.execute(
            text("""
                UPDATE auth_sessions
                SET issued_at=now()-interval '2 days',
                    expires_at=now()-interval '1 day'
                WHERE token_sha256=:digest
            """),
            {"digest": hash_session_token(member_token)},
        )
    assert client.get(path, headers=headers(member_token)).status_code == 401

    second_member_token = authenticate(client, reader[0], reader[1]).json()["token"]
    assert client.get(path, headers=headers(second_member_token)).status_code == 200
    with owner.begin() as conn:
        conn.execute(
            text("DELETE FROM profile_access WHERE profile_id=:id AND user_id=:user"),
            {"id": profile, "user": reader[0]},
        )
    # A valid session cannot override revoked profile grants.
    assert client.get(path, headers=headers(second_member_token)).status_code == 404


def test_login_throttle_is_shared_and_does_not_reveal_account_existence(protected):
    client, owner, _, users = protected
    editor = users[0]
    email = f"fictional-{editor[0].hex[:12]}@example.invalid"
    wrong = {
        "organization_id": str(editor[1]),
        "email": email,
        "password": "An incorrect password",
    }

    # Five attempts are processed; the sixth is rejected before password KDF.
    for _ in range(5):
        response = client.post("/api/v1/auth/login", json=wrong)
        assert response.status_code == 401
        assert response.json()["code"] == "INVALID_CREDENTIALS"
    blocked = client.post("/api/v1/auth/login", json=wrong)
    assert blocked.status_code == 429
    assert blocked.json()["code"] == "LOGIN_RATE_LIMITED"

    # A correct password cannot bypass the lockout.
    correct = client.post("/api/v1/auth/login", json={**wrong, "password": PASSWORD})
    assert correct.status_code == 429

    email_hash = login_bucket_digest(editor[1], email)
    with owner.begin() as connection:
        bucket = connection.execute(
            text(
                "SELECT attempt_count,blocked_until FROM auth_login_attempts "
                "WHERE organization_id=:org AND email_sha256=:digest"
            ),
            {"org": editor[1], "digest": email_hash},
        ).one()
        assert bucket.attempt_count >= 7
        assert bucket.blocked_until is not None

        # Advance only the synthetic test bucket to verify window expiration.
        connection.execute(
            text(
                "UPDATE auth_login_attempts "
                "SET window_started=now()-interval '16 minutes',"
                "blocked_until=now()-interval '1 minute' "
                "WHERE organization_id=:org AND email_sha256=:digest"
            ),
            {"org": editor[1], "digest": email_hash},
        )

    renewed = client.post("/api/v1/auth/login", json={**wrong, "password": PASSWORD})
    assert renewed.status_code == 200
    with owner.begin() as connection:
        assert (
            connection.execute(
                text(
                    "SELECT count(*) FROM auth_login_attempts "
                    "WHERE organization_id=:org AND email_sha256=:digest"
                ),
                {"org": editor[1], "digest": email_hash},
            ).scalar_one()
            == 0
        )

    # Unknown identity receives the same generic 401, and cannot share a
    # throttle bucket with a distinct account or organization.
    missing = client.post(
        "/api/v1/auth/login",
        json={**wrong, "email": "nonexistent@example.invalid"},
    )
    assert missing.status_code == 401
    assert missing.json()["code"] == "INVALID_CREDENTIALS"
    another_tenant = client.post(
        "/api/v1/auth/login",
        json={**wrong, "organization_id": str(SECOND_WORKSPACE)},
    )
    assert another_tenant.status_code == 401
    assert another_tenant.json()["code"] == "INVALID_CREDENTIALS"


def test_login_throttle_survives_independent_connections(protected):
    client, owner, _, users = protected
    editor = users[0]
    email = f"fictional-{editor[0].hex[:12]}@example.invalid"
    digest = login_bucket_digest(editor[1], email)

    # Tests the actual SECURITY DEFINER function through two independent
    # PostgreSQL connections, rather than an in-process Python counter.
    for index in range(1, 7):
        with owner.begin() as connection:
            ok = connection.execute(
                text("SELECT consume_auth_login_attempt(:org,CAST(:digest AS char(64)))"),
                {"org": editor[1], "digest": digest},
            ).scalar_one()
        assert ok is (index <= 5)

    assert authenticate(client, editor[0], editor[1]).status_code == 429
