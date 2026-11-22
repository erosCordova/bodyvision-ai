"""Opt-in authenticated API behaviour on disposable synthetic PostgreSQL only."""

import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import DBAPIError

from app.core.config import Settings
from app.core.identity import hash_password, hash_session_token, login_bucket_digest
from app.main import create_app
from app.models.context import FIRST_WORKSPACE, SECOND_WORKSPACE

PASSWORD = "Synthetic test passphrase 2026!"

CONSENT_BODY = {"purpose": "capture", "version": "bv-synthetic-v1", "confirmed": True}


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
    editor_id, reader_id, outsider_id, admin_id = uuid4(), uuid4(), uuid4(), uuid4()
    users = [
        (editor_id, FIRST_WORKSPACE, "specialist", "manage"),
        (reader_id, FIRST_WORKSPACE, "member", "read"),
        (outsider_id, SECOND_WORKSPACE, "specialist", None),
        (admin_id, FIRST_WORKSPACE, "administrator", None),
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
            capture_encryption_key=Fernet.generate_key().decode("ascii"),
            capture_retention_enabled=False,
        )
        with TestClient(create_app(settings, app_engine)) as client:
            yield client, owner, profile_id, users
    finally:
        with owner.begin() as conn:
            # Owner-only synthetic fixture reset; no runtime role can do this.
            # Disable the immutable scenario trigger solely for disposable test cleanup.
            conn.execute(
                text("""DELETE FROM simulation_request_keys WHERE scenario_id IN
                    (SELECT id FROM simulation_scenarios WHERE profile_id=:id)"""),
                {"id": profile_id},
            )
            conn.execute(
                text(
                    "ALTER TABLE simulation_scenarios "
                    "DISABLE TRIGGER immutable_simulation_scenarios"
                )
            )
            conn.execute(
                text("DELETE FROM simulation_scenarios WHERE profile_id=:id"),
                {"id": profile_id},
            )
            conn.execute(
                text(
                    "ALTER TABLE simulation_scenarios ENABLE TRIGGER immutable_simulation_scenarios"
                )
            )
            conn.execute(
                text("DELETE FROM synthetic_capture_objects WHERE profile_id=:id"),
                {"id": profile_id},
            )
            conn.execute(
                text("DELETE FROM profile_consents WHERE profile_id=:id"), {"id": profile_id}
            )
            conn.execute(
                text("DELETE FROM auth_login_attempts WHERE organization_id IN (:a,:b)"),
                {"a": FIRST_WORKSPACE, "b": SECOND_WORKSPACE},
            )
            conn.execute(
                text("DELETE FROM private_profile_permission_changes WHERE profile_id=:profile"),
                {"profile": profile_id},
            )
            # Owner-only reset on the disposable CI database. Runtime roles
            # cannot prune the append-only audit or its verification heads.
            conn.execute(
                text(
                    "TRUNCATE private_profile_permission_changes,"
                    "security_audit_events,private_audit_heads"
                )
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
    editor, reader, outsider = users[:3]
    path = "/api/v1/profiles/" + str(profile)
    assert client.get(path).status_code == 401
    login = authenticate(client, editor[0], editor[1])
    assert login.status_code == 200, login.text
    session = login.json()
    assert session["role"] == "specialist"
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
    editor, reader, outsider = users[:3]
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


def test_public_api_cannot_bootstrap_an_administrator(protected):
    client, owner, _, users = protected
    administrator = users[3]
    token = authenticate(client, administrator[0], administrator[1]).json()["token"]
    payload = {
        "display_name": "Administrador sin verificación",
        "email": "unapproved.admin@example.invalid",
        "password": PASSWORD,
        "role": "administrator",
    }
    response = client.post("/api/v1/auth/users", json=payload, headers=headers(token))
    assert response.status_code == 422
    no_session = client.post(
        "/api/v1/auth/users",
        json={**payload, "role": "member"},
    )
    assert no_session.status_code == 401
    with owner.connect() as connection:
        assert (
            connection.execute(
                text("SELECT count(*) FROM users WHERE lower(email)=:email"),
                {"email": payload["email"]},
            ).scalar_one()
            == 0
        )


def test_administrator_provisions_synthetic_member_and_audit_is_tenant_bound(protected):
    client, owner, profile, users = protected
    admin, member, outsider = users[3], users[1], users[2]
    admin_token = authenticate(client, admin[0], admin[1]).json()["token"]
    member_token = authenticate(client, member[0], member[1]).json()["token"]
    outsider_token = authenticate(client, outsider[0], outsider[1]).json()["token"]

    # Platform administration does not automatically grant record access.
    admin_view = client.get(f"/api/v1/profiles/{profile}", headers=headers(admin_token))
    assert admin_view.status_code == 404

    name = "Usuario ficticio administrado"
    email = "provisioned.member@example.invalid"
    body = {
        "display_name": name,
        "email": email,
        "password": PASSWORD,
        "role": "member",
    }
    denied = client.post("/api/v1/auth/users", json=body, headers=headers(member_token))
    assert denied.status_code == 403

    created = client.post("/api/v1/auth/users", json=body, headers=headers(admin_token))
    assert created.status_code == 201, created.text
    user_data = created.json()
    assert user_data["organization_id"] == str(FIRST_WORKSPACE)
    assert user_data["role"] == "member"
    assert "password" not in user_data and "password_hash" not in user_data
    created_user = UUID(user_data["id"])
    users.append((created_user, FIRST_WORKSPACE, "member", None))

    with owner.connect() as conn:
        info = (
            conn.execute(
                text(
                    "SELECT email,password_hash,account_status,is_local_operator "
                    "FROM users WHERE id=:id"
                ),
                {"id": created_user},
            )
            .mappings()
            .one()
        )
        assert info["email"] == email
        assert PASSWORD not in info["password_hash"]
        assert info["password_hash"].startswith("pbkdf2_sha256$")
        assert info["account_status"] == "active"
        assert not info["is_local_operator"]

    enrolled = client.post(
        "/api/v1/auth/login",
        json={
            "organization_id": str(FIRST_WORKSPACE),
            "email": email,
            "password": PASSWORD,
        },
    )
    assert enrolled.status_code == 200
    assert enrolled.json()["role"] == "member"

    # No implicit profile grant for new users.
    new_member_view = client.get(
        f"/api/v1/profiles/{profile}", headers=headers(enrolled.json()["token"])
    )
    assert new_member_view.status_code == 404

    audit = client.get("/api/v1/auth/audit?limit=50", headers=headers(admin_token))
    assert audit.status_code == 200, audit.text
    events = audit.json()
    assert any(
        event["action"] == "admin.user_provisioned"
        and event["resource_id"] == str(created_user)
        and event["actor_id"] == str(admin[0])
        for event in events
    )
    assert any(event["action"] == "admin.user_provision_denied" for event in events)
    assert any(event["action"] == "auth.login" for event in events)
    assert PASSWORD not in audit.text
    assert admin_token not in audit.text

    member_audit = client.get("/api/v1/auth/audit", headers=headers(member_token))
    outsider_audit = client.get("/api/v1/auth/audit", headers=headers(outsider_token))
    outsider_provision = client.post(
        "/api/v1/auth/users", json=body, headers=headers(outsider_token)
    )
    assert member_audit.status_code == 403
    assert outsider_audit.status_code == 403
    assert outsider_provision.status_code == 403


def test_private_user_provisioning_fails_closed_for_duplicate_and_invalid_data(protected):
    client, owner, _, users = protected
    admin = users[3]
    admin_token = authenticate(client, admin[0], admin[1]).json()["token"]
    email = "provisioned.unique@example.invalid"
    body = {
        "display_name": "Usuario ficticio permitido",
        "email": email,
        "password": PASSWORD,
        "role": "specialist",
    }

    elevated = client.post(
        "/api/v1/auth/users",
        json={**body, "role": "administrator"},
        headers=headers(admin_token),
    )
    nonsynthetic = client.post(
        "/api/v1/auth/users",
        json={**body, "email": "person@real-company.com"},
        headers=headers(admin_token),
    )
    supplied_tenant = client.post(
        "/api/v1/auth/users",
        json={**body, "organization_id": str(SECOND_WORKSPACE)},
        headers=headers(admin_token),
    )
    assert elevated.status_code == 422
    assert nonsynthetic.status_code == 422
    assert supplied_tenant.status_code == 422

    created = client.post("/api/v1/auth/users", json=body, headers=headers(admin_token))
    assert created.status_code == 201
    new_id = UUID(created.json()["id"])
    users.append((new_id, FIRST_WORKSPACE, "specialist", None))
    duplicate = client.post("/api/v1/auth/users", json=body, headers=headers(admin_token))
    assert duplicate.status_code == 409
    with owner.connect() as connection:
        same_org = connection.execute(
            text("SELECT count(*) FROM users WHERE organization_id=:org AND email=:email"),
            {"org": FIRST_WORKSPACE, "email": email},
        ).scalar_one()
        other_org = connection.execute(
            text("SELECT count(*) FROM users WHERE organization_id=:org AND email=:email"),
            {"org": SECOND_WORKSPACE, "email": email},
        ).scalar_one()
        assert same_org == 1
        assert other_org == 0


def test_profile_access_and_modifications_are_audited_per_tenant(protected):
    client, owner, profile, users = protected
    editor, reader, outsider, administrator = users[:4]
    editor_token = authenticate(client, editor[0], editor[1]).json()["token"]
    reader_token = authenticate(client, reader[0], reader[1]).json()["token"]
    outsider_token = authenticate(client, outsider[0], outsider[1]).json()["token"]
    admin_token = authenticate(client, administrator[0], administrator[1]).json()["token"]
    path = f"/api/v1/profiles/{profile}"

    editor_read = client.get(path, headers=headers(editor_token))
    assert editor_read.status_code == 200
    editor_write = client.patch(
        path,
        headers=headers(editor_token),
        json={"display_name": "Expediente ficticio auditado"},
    )
    assert editor_write.status_code == 200
    reader_read = client.get(path, headers=headers(reader_token))
    assert reader_read.status_code == 200

    # Failed actions never create an "allowed" audit entry.
    assert (
        client.patch(
            path, headers=headers(reader_token), json={"display_name": "No autorizado"}
        ).status_code
        == 403
    )
    assert client.get(path, headers=headers(outsider_token)).status_code == 404
    assert client.get(path, headers=headers(admin_token)).status_code == 404

    with owner.connect() as connection:
        entries = (
            connection.execute(
                text(
                    "SELECT organization_id,actor_id,correlation_id,action,"
                    "resource_type,resource_id,outcome "
                    "FROM security_audit_events WHERE resource_id=:profile "
                    "AND action LIKE 'profile.%'"
                ),
                {"profile": profile},
            )
            .mappings()
            .all()
        )
    assert len(entries) == 3
    assert {(x["action"], x["actor_id"]) for x in entries} == {
        ("profile.read", editor[0]),
        ("profile.update", editor[0]),
        ("profile.read", reader[0]),
    }
    assert all(
        x["organization_id"] == FIRST_WORKSPACE
        and x["resource_type"] == "profile"
        and x["resource_id"] == profile
        and x["outcome"] == "allowed"
        and x["correlation_id"] is not None
        for x in entries
    )
    assert {str(x["correlation_id"]) for x in entries} == {
        editor_read.headers["X-Correlation-ID"],
        editor_write.headers["X-Correlation-ID"],
        reader_read.headers["X-Correlation-ID"],
    }
    admin_audit = client.get("/api/v1/auth/audit?limit=50", headers=headers(admin_token))
    assert admin_audit.status_code == 200
    assert any(
        e["action"] == "profile.update" and e["resource_id"] == str(profile)
        for e in admin_audit.json()
    )
    assert "Expediente ficticio auditado" not in admin_audit.text
    assert editor_token not in admin_audit.text


def test_reading_measurements_and_analytics_creates_profile_scoped_events(protected):
    client, owner, profile, users = protected
    editor = users[0]
    token = authenticate(client, editor[0], editor[1]).json()["token"]
    paths = (
        (f"/api/v1/profiles/{profile}/measurements", "measurement.list"),
        (f"/api/v1/profiles/{profile}/analytics/derived", "analytics.read"),
        (f"/api/v1/profiles/{profile}/analytics/series", "analytics.read"),
    )
    for path, action in paths:
        response = client.get(path, headers=headers(token))
        assert response.status_code == 200, response.text
        with owner.connect() as connection:
            exists = connection.execute(
                text(
                    "SELECT count(*) FROM security_audit_events "
                    "WHERE actor_id=:actor AND resource_id=:profile "
                    "AND correlation_id=:correlation AND action=:action"
                ),
                {
                    "actor": editor[0],
                    "profile": profile,
                    "correlation": response.headers["X-Correlation-ID"],
                    "action": action,
                },
            ).scalar_one()
        assert exists == 1


def test_unverified_data_connection_cannot_forge_profile_audit(protected):
    _, owner, profile, users = protected
    with owner.begin() as connection:
        allowed_to_call = connection.execute(
            text(
                "SELECT has_function_privilege("
                "'bodyvision_app','record_private_profile_event(uuid,uuid,uuid,text)',"
                "'EXECUTE')"
            )
        ).scalar_one()
        auth_cannot_call = connection.execute(
            text(
                "SELECT has_function_privilege("
                "'bodyvision_auth_app','record_private_profile_event(uuid,uuid,uuid,text)',"
                "'EXECUTE')"
            )
        ).scalar_one()
    assert allowed_to_call
    assert not auth_cannot_call

    with owner.connect() as connection:
        with connection.begin():
            connection.execute(text("SET LOCAL ROLE bodyvision_app"))
            with pytest.raises(DBAPIError):
                with connection.begin_nested():
                    connection.execute(
                        text(
                            "SELECT record_private_profile_event("
                            ":event,:correlation,:profile,'profile.read')"
                        ),
                        {"event": uuid4(), "correlation": uuid4(), "profile": profile},
                    )


def test_private_profile_grants_are_limited_audited_and_revocable(protected):
    client, owner, profile, users = protected
    editor, member, outsider, admin = users[:4]
    admin_token = authenticate(client, admin[0], admin[1]).json()["token"]
    member_token = authenticate(client, member[0], member[1]).json()["token"]
    editor_token = authenticate(client, editor[0], editor[1]).json()["token"]
    outsider_token = authenticate(client, outsider[0], outsider[1]).json()["token"]
    path = f"/api/v1/profiles/{profile}"
    grant_path = "/api/v1/auth/profile-access/grant"
    revoke_path = "/api/v1/auth/profile-access/revoke"
    grant = {"profile_id": str(profile), "user_id": str(member[0]), "access_level": "read"}

    disallowed = client.post(
        grant_path, json={**grant, "access_level": "manage"}, headers=headers(admin_token)
    )
    assert disallowed.status_code == 404
    assert client.get(path, headers=headers(member_token)).status_code == 200
    revoked = client.post(
        revoke_path,
        json={"profile_id": str(profile), "user_id": str(member[0])},
        headers=headers(admin_token),
    )
    assert revoked.status_code == 200, revoked.text
    assert revoked.json()["status"] == "revoked"
    assert client.get(path, headers=headers(member_token)).status_code == 404

    restored = client.post(grant_path, json=grant, headers=headers(admin_token))
    assert restored.status_code == 200, restored.text
    assert restored.json()["status"] == "granted"
    assert client.get(path, headers=headers(member_token)).status_code == 200

    with owner.connect() as connection:
        access = connection.execute(
            text(
                "SELECT access_level,expires_at FROM profile_access "
                "WHERE organization_id=:org AND profile_id=:profile AND user_id=:user"
            ),
            {"org": FIRST_WORKSPACE, "profile": profile, "user": member[0]},
        ).one()
        assert access.access_level == "read"
        assert access.expires_at > datetime.now(UTC) + timedelta(days=29)
        changes = (
            connection.execute(
                text(
                    "SELECT c.subject_user_id,c.previous_level,c.new_level,"
                    "e.organization_id,e.actor_id,e.action,e.outcome "
                    "FROM private_profile_permission_changes c "
                    "JOIN security_audit_events e ON e.id=c.event_id "
                    "WHERE c.profile_id=:profile"
                ),
                {"profile": profile},
            )
            .mappings()
            .all()
        )
    assert len(changes) == 2
    assert {(x["previous_level"], x["new_level"]) for x in changes} == {
        ("read", None),
        (None, "read"),
    }
    assert {x["action"] for x in changes} == {
        "profile.permission_granted",
        "profile.permission_revoked",
    }
    assert all(
        x["subject_user_id"] == member[0]
        and x["organization_id"] == FIRST_WORKSPACE
        and x["actor_id"] == admin[0]
        and x["outcome"] == "allowed"
        for x in changes
    )

    self_grant = client.post(
        grant_path,
        json={"profile_id": str(profile), "user_id": str(admin[0]), "access_level": "manage"},
        headers=headers(admin_token),
    )
    assert self_grant.status_code == 404
    assert client.get(path, headers=headers(admin_token)).status_code == 404
    assert client.post(grant_path, json=grant, headers=headers(editor_token)).status_code == 403
    assert (
        client.post(
            revoke_path,
            json={"profile_id": str(profile), "user_id": str(member[0])},
            headers=headers(member_token),
        ).status_code
        == 403
    )
    cross = client.post(
        grant_path,
        json={
            "profile_id": str(profile),
            "user_id": str(outsider[0]),
            "access_level": "read",
        },
        headers=headers(admin_token),
    )
    assert cross.status_code == 404
    assert client.get(path, headers=headers(outsider_token)).status_code == 404


def test_repeated_permission_revocation_is_not_logged_as_success(protected):
    client, owner, profile, users = protected
    admin = users[3]
    member = users[1]
    token = authenticate(client, admin[0], admin[1]).json()["token"]
    payload = {"profile_id": str(profile), "user_id": str(member[0])}
    first = client.post("/api/v1/auth/profile-access/revoke", json=payload, headers=headers(token))
    assert first.status_code == 200
    repeated = client.post(
        "/api/v1/auth/profile-access/revoke", json=payload, headers=headers(token)
    )
    assert repeated.status_code == 404
    unknown = client.post(
        "/api/v1/auth/profile-access/grant",
        json={**payload, "profile_id": str(uuid4()), "access_level": "read"},
        headers=headers(token),
    )
    assert unknown.status_code == 404
    with owner.connect() as connection:
        count = connection.execute(
            text(
                "SELECT count(*) FROM private_profile_permission_changes WHERE profile_id=:profile"
            ),
            {"profile": profile},
        ).scalar_one()
    assert count == 1


def test_consent_accept_revoke_renew_preserves_history_and_audit(protected):
    client, owner, profile, users = protected
    editor = users[0]
    token = authenticate(client, editor[0], editor[1]).json()["token"]
    path = f"/api/v1/auth/profiles/{profile}/consents"
    assert client.get(path, headers=headers(token)).json()["items"] == []
    accepted = client.post(path, headers=headers(token), json=CONSENT_BODY)
    assert accepted.status_code == 200, accepted.text
    data = accepted.json()
    assert data["can_record"] and data["can_revoke"]
    first = data["items"][0]
    assert first["status"] == "accepted" and first["effective"]
    assert first["cycle"] == 1 and first["recorded_by"] == str(editor[0])
    assert first["revoked_by"] is None
    lifetime = datetime.fromisoformat(first["expires_at"]) - datetime.fromisoformat(
        first["accepted_at"]
    )
    assert lifetime == timedelta(days=30)

    # Retries are idempotent; no invented extra acceptance or audit success.
    again = client.post(path, headers=headers(token), json=CONSENT_BODY)
    assert again.status_code == 200
    assert again.json()["items"] == [first]
    revoked = client.post(path + f"/{first['id']}/revoke", headers=headers(token), json={})
    assert revoked.status_code == 200
    old = revoked.json()["items"][0]
    assert not old["effective"] and old["status"] == "revoked"
    assert old["accepted_at"] == first["accepted_at"]
    assert old["revoked_at"] and old["revoked_by"] == str(editor[0])
    assert client.post(path + f"/{first['id']}/revoke", headers=headers(token)).status_code == 409

    renewed = client.post(path, headers=headers(token), json=CONSENT_BODY).json()["items"]
    assert len(renewed) == 2
    assert [r["cycle"] for r in renewed if r["effective"]] == [2]
    assert any(r["id"] == first["id"] and r["status"] == "revoked" for r in renewed)
    with owner.connect() as connection:
        events = (
            connection.execute(
                text(
                    "SELECT action FROM security_audit_events WHERE resource_id=:profile "
                    "AND action IN ('consent.accepted','consent.revoked') ORDER BY happened_at"
                ),
                {"profile": profile},
            )
            .scalars()
            .all()
        )
    assert events == ["consent.accepted", "consent.revoked", "consent.accepted"]


def test_consent_scope_uses_session_role_and_explicit_unexpired_grants(protected):
    client, owner, profile, users = protected
    tokens = [authenticate(client, u[0], u[1]).json()["token"] for u in users]
    path = f"/api/v1/auth/profiles/{profile}/consents"
    assert client.get(path).status_code == 401
    read = client.get(path, headers=headers(tokens[1]))
    assert read.status_code == 200
    assert not read.json()["can_record"] and not read.json()["can_revoke"]
    assert client.post(path, headers=headers(tokens[1]), json=CONSENT_BODY).status_code == 403
    for token in tokens[2:]:
        assert client.get(path, headers=headers(token)).status_code == 404
        assert client.post(path, headers=headers(token), json=CONSENT_BODY).status_code == 404
    assert (
        client.get(
            path, headers={**headers(tokens[0]), "X-Workspace-ID": str(SECOND_WORKSPACE)}
        ).status_code
        == 400
    )
    with owner.begin() as connection:
        connection.execute(
            text(
                "UPDATE profile_access SET expires_at=now()-interval '1 second' "
                "WHERE profile_id=:profile AND user_id=:user"
            ),
            {"profile": profile, "user": users[0][0]},
        )
    assert client.get(path, headers=headers(tokens[0])).status_code == 404
    assert client.post(path, headers=headers(tokens[0]), json=CONSENT_BODY).status_code == 404


def test_consent_expiry_versions_and_archival_do_not_enable_processing(protected):
    client, owner, profile, users = protected
    token = authenticate(client, users[0][0], users[0][1]).json()["token"]
    path = f"/api/v1/auth/profiles/{profile}/consents"
    accepted = client.post(path, headers=headers(token), json=CONSENT_BODY).json()["items"][0]
    with owner.begin() as connection:
        connection.execute(
            text(
                "UPDATE profile_consents SET accepted_at=now()-interval '31 days',"
                "expires_at=now()-interval '1 day' WHERE id=:id"
            ),
            {"id": UUID(accepted["id"])},
        )
    expired = client.get(path, headers=headers(token)).json()["items"][0]
    assert not expired["effective"]
    renewed = client.post(path, headers=headers(token), json=CONSENT_BODY)
    assert renewed.status_code == 200
    assert len(renewed.json()["items"]) == 2
    assert len([r for r in renewed.json()["items"] if r["effective"]]) == 1
    # An old document version is visible as history, never a current acceptance.
    with owner.begin() as connection:
        connection.execute(
            text("UPDATE profile_consents SET version='obsolete-v0' WHERE profile_id=:profile"),
            {"profile": profile},
        )
    assert not any(r["effective"] for r in client.get(path, headers=headers(token)).json()["items"])
    current = client.post(path, headers=headers(token), json=CONSENT_BODY).json()["items"]
    valid = next(r for r in current if r["effective"])
    archived = client.post(f"/api/v1/profiles/{profile}/archive", headers=headers(token))
    assert archived.status_code == 200
    state = client.get(path, headers=headers(token)).json()
    assert not state["can_record"] and state["can_revoke"]
    assert client.post(path, headers=headers(token), json=CONSENT_BODY).status_code == 409
    assert client.post(path + f"/{valid['id']}/revoke", headers=headers(token)).status_code == 200


def test_consent_rejects_forged_scope_version_confirmation_and_stale_target(protected):
    client, _, profile, users = protected
    token = authenticate(client, users[0][0], users[0][1]).json()["token"]
    path = f"/api/v1/auth/profiles/{profile}/consents"
    for invalid in [
        {**CONSENT_BODY, "confirmed": False},
        {**CONSENT_BODY, "confirmed": 1},
        {**CONSENT_BODY, "version": "not-reviewed"},
        {**CONSENT_BODY, "purpose": "anything"},
        {**CONSENT_BODY, "organization_id": str(SECOND_WORKSPACE)},
        {**CONSENT_BODY, "accepted_at": datetime.now(UTC).isoformat()},
    ]:
        assert client.post(path, headers=headers(token), json=invalid).status_code == 422
    assert client.post(path + f"/{uuid4()}/revoke", headers=headers(token)).status_code == 409
    assert client.get(path, headers=headers(token)).json()["items"] == []


def test_parallel_acceptance_creates_only_one_current_cycle(protected):
    client, _, profile, users = protected
    token = authenticate(client, users[0][0], users[0][1]).json()["token"]
    path = f"/api/v1/auth/profiles/{profile}/consents"

    def accept(_):
        return client.post(path, headers=headers(token), json=CONSENT_BODY)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(accept, range(2)))
    assert all(r.status_code == 200 for r in results)
    state = client.get(path, headers=headers(token)).json()
    assert len(state["items"]) == 1 and state["items"][0]["effective"]


def test_consent_rolls_back_when_audit_storage_fails(protected):
    client, owner, profile, users = protected
    token = authenticate(client, users[0][0], users[0][1]).json()["token"]
    path = f"/api/v1/auth/profiles/{profile}/consents"
    # Isolated test DB only: fail the real INSERT nested inside SECURITY DEFINER.
    try:
        with owner.begin() as connection:
            connection.execute(
                text("""
                CREATE FUNCTION test_reject_consent_audit() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                  IF NEW.action='consent.accepted' THEN
                    RAISE EXCEPTION 'Synthetic audit failure';
                  END IF;
                  RETURN NEW;
                END $$;
                CREATE TRIGGER test_consent_audit_failure BEFORE INSERT ON security_audit_events
                  FOR EACH ROW EXECUTE FUNCTION test_reject_consent_audit();
            """)
            )
        assert client.post(path, headers=headers(token), json=CONSENT_BODY).status_code == 500
        with owner.connect() as connection:
            count = connection.execute(
                text("SELECT count(*) FROM profile_consents WHERE profile_id=:profile"),
                {"profile": profile},
            ).scalar_one()
        assert count == 0
    finally:
        with owner.begin() as connection:
            connection.execute(
                text("DROP TRIGGER IF EXISTS test_consent_audit_failure ON security_audit_events")
            )
            connection.execute(text("DROP FUNCTION IF EXISTS test_reject_consent_audit()"))


def test_consent_function_uses_public_tables_when_runtime_has_temporary_namesakes(protected):
    client, _, profile, users = protected
    token = authenticate(client, users[0][0], users[0][1]).json()["token"]
    runtime = create_engine(os.environ["AUTH_DATABASE_URL"], hide_parameters=True)
    try:
        with runtime.begin() as connection:
            # The runtime role may create temporary tables. They must never
            # shadow the trusted tables inside this SECURITY DEFINER function.
            connection.execute(text("CREATE TEMP TABLE profiles(shadow integer)"))
            result = connection.execute(
                text(
                    "SELECT private_profile_consents(CAST(:token AS char(64)),:profile,"
                    "'list',NULL,NULL,:new_id,:event,:correlation)"
                ),
                {
                    "token": hash_session_token(token),
                    "profile": profile,
                    "new_id": uuid4(),
                    "event": uuid4(),
                    "correlation": uuid4(),
                },
            ).scalar_one()
            assert result["items"] == [] and result["can_record"]
    finally:
        runtime.dispose()


RESET_PASSWORD = "New fictional passphrase 2026!"
RESET_BODY = {"administrator_password": PASSWORD, "new_password": RESET_PASSWORD}


def test_admin_reset_revokes_all_old_sessions_preserves_grants_and_audits(protected):
    client, owner, profile, users = protected
    member, admin = users[1], users[3]
    admin_token = authenticate(client, admin[0], admin[1]).json()["token"]
    old_tokens = [authenticate(client, member[0], member[1]).json()["token"] for _ in range(2)]
    for _ in range(6):
        failed = client.post(
            "/api/v1/auth/login",
            json={
                "organization_id": str(member[1]),
                "email": f"fictional-{member[0].hex[:12]}@example.invalid",
                "password": "Wrong password before recovery",
            },
        )
    assert failed.status_code == 429
    path = f"/api/v1/auth/users/{member[0]}/reset-password"
    response = client.post(path, headers=headers(admin_token), json=RESET_BODY)
    assert response.status_code == 200, response.text
    assert response.json() == {"user_id": str(member[0]), "status": "reset", "revoked_sessions": 2}
    for old_token in old_tokens:
        assert client.get("/api/v1/auth/me", headers=headers(old_token)).status_code == 401
    assert authenticate(client, member[0], member[1]).status_code == 401
    new_login = client.post(
        "/api/v1/auth/login",
        json={
            "organization_id": str(member[1]),
            "email": f"fictional-{member[0].hex[:12]}@example.invalid",
            "password": RESET_PASSWORD,
        },
    )
    assert new_login.status_code == 200 and new_login.json()["role"] == "member"
    assert (
        client.get(
            f"/api/v1/profiles/{profile}", headers=headers(new_login.json()["token"])
        ).status_code
        == 200
    )
    assert client.get("/api/v1/auth/me", headers=headers(admin_token)).status_code == 200
    audit = client.get("/api/v1/auth/audit?limit=50", headers=headers(admin_token))
    assert any(
        e["action"] == "admin.password_reset" and e["resource_id"] == str(member[0])
        for e in audit.json()
    )
    for secret in (PASSWORD, RESET_PASSWORD, admin_token, *old_tokens):
        assert secret not in audit.text and secret not in response.text
    with owner.connect() as connection:
        assert (
            connection.execute(
                text(
                    "SELECT access_level FROM profile_access "
                    "WHERE profile_id=:profile AND user_id=:user"
                ),
                {"profile": profile, "user": member[0]},
            ).scalar_one()
            == "read"
        )


def test_reset_rejects_non_admin_cross_tenant_self_admin_and_disabled_accounts(protected):
    client, owner, _, users = protected
    tokens = [authenticate(client, u[0], u[1]).json()["token"] for u in users]
    target = users[1][0]
    path = f"/api/v1/auth/users/{target}/reset-password"
    assert client.post(path, json=RESET_BODY).status_code == 401
    for token in tokens[:3]:
        assert client.post(path, headers=headers(token), json=RESET_BODY).status_code == 403
    for subject in (users[2][0], users[3][0], uuid4()):
        result = client.post(
            f"/api/v1/auth/users/{subject}/reset-password",
            headers=headers(tokens[3]),
            json=RESET_BODY,
        )
        assert result.status_code == 404
    with owner.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO user_role_assignments(id,organization_id,user_id,role) "
                "VALUES (:id,:org,:user,'administrator')"
            ),
            {"id": uuid4(), "org": FIRST_WORKSPACE, "user": users[0][0]},
        )
        connection.execute(
            text("UPDATE users SET account_status='disabled' WHERE id=:id"), {"id": target}
        )
    assert (
        client.post(
            f"/api/v1/auth/users/{users[0][0]}/reset-password",
            headers=headers(tokens[3]),
            json=RESET_BODY,
        ).status_code
        == 404
    )
    assert client.post(path, headers=headers(tokens[3]), json=RESET_BODY).status_code == 404
    with owner.connect() as connection:
        assert (
            connection.execute(
                text(
                    "SELECT count(*) FROM security_audit_events "
                    "WHERE action='admin.password_reset_denied' AND actor_id=ANY(:ids)"
                ),
                {"ids": [u[0] for u in users]},
            ).scalar_one()
            == 8
        )


def test_reset_requires_admin_reauthentication_with_a_separate_shared_throttle(protected):
    client, owner, _, users = protected
    member, admin = users[1], users[3]
    admin_token = authenticate(client, admin[0], admin[1]).json()["token"]
    member_token = authenticate(client, member[0], member[1]).json()["token"]
    path = f"/api/v1/auth/users/{member[0]}/reset-password"
    for _ in range(5):
        wrong = client.post(
            path,
            headers=headers(admin_token),
            json={**RESET_BODY, "administrator_password": "Wrong admin password"},
        )
        assert wrong.status_code == 403 and wrong.json()["code"] == "RESET_REAUTH_REQUIRED"
    blocked = client.post(path, headers=headers(admin_token), json=RESET_BODY)
    assert blocked.status_code == 429 and blocked.json()["code"] == "RESET_RATE_LIMITED"
    assert client.get("/api/v1/auth/me", headers=headers(member_token)).status_code == 200
    assert authenticate(client, admin[0], admin[1]).status_code == 200
    digest = login_bucket_digest(admin[1], f"password-reset:{admin[0]}")
    with owner.connect() as connection:
        count = connection.execute(
            text(
                "SELECT attempt_count FROM auth_login_attempts "
                "WHERE organization_id=:org AND email_sha256=:digest"
            ),
            {"org": admin[1], "digest": digest},
        ).scalar_one()
    assert count == 6


def test_reset_rejects_supplied_scope_and_invalid_secret_lengths(protected):
    client, _, _, users = protected
    token = authenticate(client, users[3][0], users[3][1]).json()["token"]
    path = f"/api/v1/auth/users/{users[1][0]}/reset-password"
    for invalid in [
        {**RESET_BODY, "new_password": "short"},
        {**RESET_BODY, "new_password": "x" * 129},
        {**RESET_BODY, "organization_id": str(SECOND_WORKSPACE)},
        {**RESET_BODY, "role": "administrator"},
    ]:
        assert client.post(path, headers=headers(token), json=invalid).status_code == 422
    assert (
        client.post(
            path,
            headers={**headers(token), "X-Workspace-ID": str(SECOND_WORKSPACE)},
            json=RESET_BODY,
        ).status_code
        == 400
    )


def test_login_verified_before_reset_cannot_issue_a_new_session_after_reset(protected):
    from threading import Event

    client, _, _, users = protected
    member, admin = users[1], users[3]
    admin_token = authenticate(client, admin[0], admin[1]).json()["token"]
    ready, release = Event(), Event()
    engine = client.app.state.auth_engine

    def pause_issuance(connection, cursor, statement, parameters, context, executemany):
        if "issue_private_session" in statement or "INSERT INTO auth_sessions" in statement:
            ready.set()
            assert release.wait(5), "Reset did not complete before session issuance"

    event.listen(engine, "before_cursor_execute", pause_issuance)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            old_login = pool.submit(authenticate, client, member[0], member[1])
            try:
                assert ready.wait(5), "Login did not reach session issuance"
                reset = client.post(
                    f"/api/v1/auth/users/{member[0]}/reset-password",
                    headers=headers(admin_token),
                    json=RESET_BODY,
                )
                assert reset.status_code == 200
            finally:
                release.set()
            assert old_login.result(timeout=5).status_code == 401
    finally:
        release.set()
        event.remove(engine, "before_cursor_execute", pause_issuance)


def test_reset_audit_failure_rolls_back_credentials_and_session_revocation(protected):
    client, owner, _, users = protected
    member, admin = users[1], users[3]
    admin_token = authenticate(client, admin[0], admin[1]).json()["token"]
    member_token = authenticate(client, member[0], member[1]).json()["token"]
    try:
        with owner.begin() as connection:
            connection.execute(
                text("""
                CREATE FUNCTION test_reject_reset_audit() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                  IF NEW.action='admin.password_reset' THEN
                    RAISE EXCEPTION 'Synthetic audit failure';
                  END IF;
                  RETURN NEW;
                END $$;
                CREATE TRIGGER test_reset_audit_failure BEFORE INSERT ON security_audit_events
                  FOR EACH ROW EXECUTE FUNCTION test_reject_reset_audit();
            """)
            )
        result = client.post(
            f"/api/v1/auth/users/{member[0]}/reset-password",
            headers=headers(admin_token),
            json=RESET_BODY,
        )
        assert result.status_code == 500
        assert client.get("/api/v1/auth/me", headers=headers(member_token)).status_code == 200
        assert authenticate(client, member[0], member[1]).status_code == 200
    finally:
        with owner.begin() as connection:
            connection.execute(
                text("DROP TRIGGER IF EXISTS test_reset_audit_failure ON security_audit_events")
            )
            connection.execute(text("DROP FUNCTION IF EXISTS test_reject_reset_audit()"))


def test_reset_uses_trusted_tables_even_with_temporary_authentication_namesakes(protected):
    client, owner, _, users = protected
    member, admin = users[1], users[3]
    token = authenticate(client, admin[0], admin[1]).json()["token"]
    with owner.connect() as connection:
        verifier = connection.execute(
            text("SELECT password_hash FROM users WHERE id=:id"), {"id": admin[0]}
        ).scalar_one()
    runtime = create_engine(os.environ["AUTH_DATABASE_URL"], hide_parameters=True)
    try:
        with runtime.begin() as connection:
            connection.execute(
                text(
                    "CREATE TEMP TABLE users(shadow integer); "
                    "CREATE TEMP TABLE auth_sessions(shadow integer)"
                )
            )
            result = connection.execute(
                text(
                    "SELECT reset_synthetic_password(CAST(:digest AS char(64)),:subject,"
                    ":admin_verifier,:new_verifier,:event,:correlation)"
                ),
                {
                    "digest": hash_session_token(token),
                    "subject": member[0],
                    "admin_verifier": verifier,
                    "new_verifier": hash_password(RESET_PASSWORD),
                    "event": uuid4(),
                    "correlation": uuid4(),
                },
            ).scalar_one()
            assert result["status"] == "reset"
    finally:
        runtime.dispose()


def test_admin_directory_search_pagination_and_scope(protected):
    client, _, _, users = protected
    admin = authenticate(client, users[3][0], users[3][1]).json()["token"]
    member = authenticate(client, users[1][0], users[1][1]).json()["token"]
    path = "/api/v1/auth/users"
    assert client.get(path).status_code == 401
    assert client.get(path, headers=headers(member)).status_code == 403
    first = client.get(path + "?limit=1&offset=0", headers=headers(admin))
    assert first.status_code == 200, first.text
    assert first.json()["total"] == 3 and len(first.json()["items"]) == 1
    second = client.get(path + "?limit=1&offset=1", headers=headers(admin)).json()
    assert first.json()["items"][0]["id"] != second["items"][0]["id"]
    email = f"fictional-{users[1][0].hex[:12]}@example.invalid"
    match = client.get(path + "?search=" + email, headers=headers(admin)).json()
    assert match["total"] == 1 and match["items"][0]["manageable"]
    for row in client.get(path, headers=headers(admin)).json()["items"]:
        assert row["id"] != str(users[2][0])
        assert "password_hash" not in row and "password" not in row
        if row["role"] == "administrator":
            assert not row["manageable"]


def test_suspend_reactivate_preserves_grants_and_never_restores_old_sessions(protected):
    client, owner, profile, users = protected
    admin = authenticate(client, users[3][0], users[3][1]).json()["token"]
    old = authenticate(client, users[1][0], users[1][1]).json()["token"]
    path = f"/api/v1/auth/users/{users[1][0]}/status"
    body = {"status": "disabled", "administrator_password": PASSWORD}
    disabled = client.post(path, headers=headers(admin), json=body)
    assert disabled.status_code == 200 and disabled.json()["revoked_sessions"] == 1
    assert client.get("/api/v1/auth/me", headers=headers(old)).status_code == 401
    assert authenticate(client, users[1][0], users[1][1]).status_code == 401
    duplicate = client.post(path, headers=headers(admin), json=body)
    assert duplicate.status_code == 200 and not duplicate.json()["changed"]
    enabled = client.post(path, headers=headers(admin), json={**body, "status": "active"})
    assert enabled.status_code == 200 and enabled.json()["changed"]
    assert client.get("/api/v1/auth/me", headers=headers(old)).status_code == 401
    new = authenticate(client, users[1][0], users[1][1])
    assert new.status_code == 200
    assert (
        client.get(f"/api/v1/profiles/{profile}", headers=headers(new.json()["token"])).status_code
        == 200
    )
    with owner.connect() as connection:
        assert (
            connection.execute(
                text("SELECT access_level FROM profile_access WHERE profile_id=:p AND user_id=:u"),
                {"p": profile, "u": users[1][0]},
            ).scalar_one()
            == "read"
        )
    audit = client.get("/api/v1/auth/audit", headers=headers(admin)).json()
    assert {"admin.account_disabled", "admin.account_enabled"} <= {a["action"] for a in audit}
    disabled_event = next(a for a in audit if a["action"] == "admin.account_disabled")
    assert disabled_event["actor_label"] == f"fictional-{users[3][0].hex[:12]}@example.invalid"
    assert disabled_event["target_label"] == f"fictional-{users[1][0].hex[:12]}@example.invalid"


def test_account_changes_reject_wrong_password_self_admin_cross_tenant_and_locked(protected):
    client, owner, _, users = protected
    admin = authenticate(client, users[3][0], users[3][1]).json()["token"]
    member = authenticate(client, users[1][0], users[1][1]).json()["token"]
    path = f"/api/v1/auth/users/{users[1][0]}/status"
    body = {"status": "disabled", "administrator_password": PASSWORD}
    assert client.post(path, headers=headers(member), json=body).status_code == 403
    wrong = client.post(
        path, headers=headers(admin), json={**body, "administrator_password": "Wrong"}
    )
    assert wrong.status_code == 403 and wrong.json()["code"] == "ACCOUNT_REAUTH_REQUIRED"
    for subject in (users[3][0], users[2][0]):
        assert (
            client.post(
                f"/api/v1/auth/users/{subject}/status", headers=headers(admin), json=body
            ).status_code
            == 404
        )
    with owner.begin() as connection:
        connection.execute(
            text("UPDATE users SET account_status='locked' WHERE id=:id"), {"id": users[1][0]}
        )
    assert (
        client.post(path, headers=headers(admin), json={**body, "status": "active"}).status_code
        == 404
    )
    assert (
        client.post(
            path, headers=headers(admin), json={**body, "organization_id": str(SECOND_WORKSPACE)}
        ).status_code
        == 422
    )


def test_permission_catalog_exposes_codes_and_grants_without_clinical_contents(protected):
    client, _, profile, users = protected
    admin = authenticate(client, users[3][0], users[3][1]).json()["token"]
    member = authenticate(client, users[1][0], users[1][1]).json()["token"]
    path = f"/api/v1/auth/users/{users[1][0]}/permission-catalog"
    data = client.get(path, headers=headers(admin))
    assert data.status_code == 200, data.text
    row = next(r for r in data.json()["items"] if r["id"] == str(profile))
    assert row["access_level"] == "read" and row["effective"]
    assert set(row) == {"id", "display_code", "status", "access_level", "expires_at", "effective"}
    assert client.get(path, headers=headers(member)).status_code == 403
    assert (
        client.get(
            f"/api/v1/auth/users/{users[2][0]}/permission-catalog", headers=headers(admin)
        ).status_code
        == 404
    )
    # Administrative metadata is not authorization to read the expediente.
    assert client.get(f"/api/v1/profiles/{profile}", headers=headers(admin)).status_code == 404
    assert client.get(path + "?search=not-a-code", headers=headers(admin)).json()["items"] == []


def test_status_audit_failure_rolls_back_suspension_and_session_revocation(protected):
    client, owner, _, users = protected
    admin = authenticate(client, users[3][0], users[3][1]).json()["token"]
    member = authenticate(client, users[1][0], users[1][1]).json()["token"]
    try:
        with owner.begin() as connection:
            connection.execute(
                text("""
                CREATE FUNCTION test_status_audit() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF NEW.action='admin.account_disabled' THEN
                  RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$;
                CREATE TRIGGER test_status_audit BEFORE INSERT ON security_audit_events
                  FOR EACH ROW EXECUTE FUNCTION test_status_audit();
            """)
            )
        result = client.post(
            f"/api/v1/auth/users/{users[1][0]}/status",
            headers=headers(admin),
            json={"status": "disabled", "administrator_password": PASSWORD},
        )
        assert result.status_code == 500
        assert client.get("/api/v1/auth/me", headers=headers(member)).status_code == 200
        assert authenticate(client, users[1][0], users[1][1]).status_code == 200
    finally:
        with owner.begin() as connection:
            connection.execute(
                text("DROP TRIGGER IF EXISTS test_status_audit ON security_audit_events")
            )
            connection.execute(text("DROP FUNCTION IF EXISTS test_status_audit()"))


def test_status_confirmation_is_limited_independently_of_login(protected):
    client, _, _, users = protected
    admin = authenticate(client, users[3][0], users[3][1]).json()["token"]
    path = f"/api/v1/auth/users/{users[1][0]}/status"
    for _ in range(5):
        assert (
            client.post(
                path,
                headers=headers(admin),
                json={"status": "disabled", "administrator_password": "Wrong"},
            ).status_code
            == 403
        )
    blocked = client.post(
        path,
        headers=headers(admin),
        json={"status": "disabled", "administrator_password": PASSWORD},
    )
    assert blocked.status_code == 429 and blocked.json()["code"] == "ACCOUNT_RATE_LIMITED"
    assert authenticate(client, users[3][0], users[3][1]).status_code == 200


def test_private_simulation_scenarios_enforce_session_roles_and_audit(protected):
    client, owner, profile, users = protected
    specialist, member, outsider = users[:3]
    editor_login = authenticate(client, specialist[0], specialist[1])
    member_login = authenticate(client, member[0], member[1])
    outsider_login = authenticate(client, outsider[0], outsider[1])
    assert editor_login.status_code == 200, editor_login.text
    assert member_login.status_code == 200, member_login.text
    assert outsider_login.status_code == 200, outsider_login.text
    editor = headers(editor_login.json()["token"])
    viewer = headers(member_login.json()["token"])
    foreign = headers(outsider_login.json()["token"])
    path = f"/api/v1/profiles/{profile}/scenarios"

    assert client.get(path).status_code == 401
    assert client.get(path, headers=foreign).status_code == 404
    assert client.get(path, headers=viewer).status_code == 200
    assert (
        client.get(path, headers={**editor, "X-Workspace-ID": str(FIRST_WORKSPACE)}).status_code
        == 400
    )

    sample = {"reference_kg": 70, "variation_percent": 20, "stature_cm": 180}
    denied = client.post(path, json=sample, headers={**viewer, "Idempotency-Key": str(uuid4())})
    assert denied.status_code in {403, 404}
    outside = client.post(path, json=sample, headers={**foreign, "Idempotency-Key": str(uuid4())})
    assert outside.status_code == 404

    created = client.post(path, json=sample, headers={**editor, "Idempotency-Key": str(uuid4())})
    assert created.status_code == 201, created.text
    scenario_id = created.json()["id"]
    assert created.json()["data_type"] == "SIMULADO"
    assert client.get(f"{path}/{scenario_id}/versions", headers=editor).status_code == 200
    assert client.get(path, headers=editor).json()["total"] == 1
    assert client.get(f"{path}/{scenario_id}/versions", headers=foreign).status_code == 404

    with owner.connect() as conn:
        events = (
            conn.execute(
                text("""SELECT action,actor_id FROM security_audit_events
                WHERE resource_id=:profile AND action LIKE 'simulation.%'"""),
                {"profile": profile},
            )
            .mappings()
            .all()
        )
        assert {"simulation.create", "simulation.list", "simulation.read"} <= {
            row["action"] for row in events
        }
        assert all(row["actor_id"] in {specialist[0], member[0]} for row in events)
        assert (
            conn.execute(
                text("SELECT count(*) FROM measurements WHERE profile_id=:profile"),
                {"profile": profile},
            ).scalar_one()
            == 0
        )


def _synthetic_png():
    import struct
    import zlib

    def block(kind, data):
        payload = kind + data
        return (
            struct.pack(">I", len(data))
            + payload
            + struct.pack(">I", zlib.crc32(payload) & 0xFFFFFFFF)
        )

    image = bytes([0] + [100, 120, 140] * 32) * 64
    return (
        b"\x89PNG\r\n\x1a\n"
        + block(b"IHDR", struct.pack(">IIBBBBB", 32, 64, 8, 2, 0, 0, 0))
        + block(b"IDAT", zlib.compress(image))
        + block(b"IEND", b"")
    )


def test_encrypted_synthetic_capture_requires_both_consents_and_writer(protected):
    client, owner, profile_id, users = protected
    editor, reader, outsider = users[:3]
    writer_login = authenticate(client, editor[0], editor[1])
    reader_login = authenticate(client, reader[0], reader[1])
    outsider_login = authenticate(client, outsider[0], outsider[1])
    assert writer_login.status_code == 200
    assert reader_login.status_code == 200
    assert outsider_login.status_code == 200
    writer = headers(writer_login.json()["token"])
    member = headers(reader_login.json()["token"])
    foreign = headers(outsider_login.json()["token"])
    path = f"/api/v1/profiles/{profile_id}/captures"
    image = _synthetic_png()
    asserted = {**writer, "Content-Type": "image/png", "X-Synthetic-Only": "confirmed"}

    assert client.post(path, content=image, headers=asserted).status_code == 403
    for purpose in ("capture", "storage"):
        accepted = client.post(
            f"/api/v1/auth/profiles/{profile_id}/consents",
            headers=writer,
            json={"purpose": purpose, "version": "bv-synthetic-v1", "confirmed": True},
        )
        assert accepted.status_code == 200, accepted.text
    assert client.post(path, content=image, headers=writer).status_code == 422
    assert (
        client.post(
            path,
            content=image,
            headers={**writer, "Content-Type": "image/jpeg", "X-Synthetic-Only": "confirmed"},
        ).status_code
        == 415
    )
    assert client.post(path, content=b"GIF89a" + b"0" * 100, headers=asserted).status_code == 422
    assert (
        client.post(
            path,
            content=image,
            headers={**member, "Content-Type": "image/png", "X-Synthetic-Only": "confirmed"},
        ).status_code
        == 403
    )
    assert client.get(path, headers=foreign).status_code == 404

    saved = client.post(path, content=image, headers=asserted)
    assert saved.status_code == 201, saved.text
    result = saved.json()
    assert result["profile_id"] == str(profile_id)
    assert result["data_type"] == "SIMULADO"
    assert result["format"] == "image/png"
    assert result["width"] == 32
    capture_id = result["id"]
    assert client.get(path, headers=member).json()["total"] == 1
    assert client.get(f"{path}/{capture_id}", headers=member).content == image
    assert client.get(f"{path}/{capture_id}", headers=foreign).status_code == 404
    assert client.delete(f"{path}/{capture_id}", headers=member).status_code == 403
    downloaded = client.get(f"{path}/{capture_id}", headers=writer)
    assert downloaded.status_code == 200
    assert downloaded.content == image
    assert downloaded.headers["content-disposition"].startswith("attachment;")
    assert downloaded.headers["content-type"] == "application/octet-stream"
    assert "no-store" in downloaded.headers["cache-control"].lower().split(", ")
    assert downloaded.headers["pragma"] == "no-cache"
    assert downloaded.headers["x-content-type-options"] == "nosniff"
    assert "set-cookie" not in downloaded.headers

    with owner.connect() as conn:
        record = (
            conn.execute(
                text("""SELECT ciphertext,sha256_digest FROM synthetic_capture_objects
                WHERE id=:id"""),
                {"id": capture_id},
            )
            .mappings()
            .one()
        )
        assert not bytes(record["ciphertext"]).startswith(b"\x89PNG")
        assert b"patient" not in bytes(record["ciphertext"])
        assert (
            conn.execute(
                text("SELECT count(*) FROM measurements WHERE profile_id=:id"),
                {"id": profile_id},
            ).scalar_one()
            == 0
        )

    history = client.get(f"/api/v1/auth/profiles/{profile_id}/consents", headers=writer).json()[
        "items"
    ]
    storage = next(item for item in history if item["purpose"] == "storage")
    revoked = client.post(
        f"/api/v1/auth/profiles/{profile_id}/consents/{storage['id']}/revoke",
        headers=writer,
    )
    assert revoked.status_code == 200, revoked.text
    assert client.get(path, headers=writer).status_code == 403
    assert client.get(f"{path}/{capture_id}", headers=writer).status_code == 403
    assert client.get(f"{path}/{capture_id}", headers=member).status_code == 403
    assert client.get(f"{path}/{capture_id}", headers=foreign).status_code == 404
    with owner.connect() as conn:
        assert (
            conn.execute(
                text("SELECT count(*) FROM synthetic_capture_objects WHERE id=:id"),
                {"id": capture_id},
            ).scalar_one()
            == 0
        )
        assert (
            conn.execute(
                text(
                    "SELECT count(*) FROM security_audit_events WHERE resource_id=:id "
                    "AND action LIKE 'capture.%'"
                ),
                {"id": profile_id},
            ).scalar_one()
            >= 3
        )


def test_expired_private_synthetic_capture_is_unreadable_and_purgeable(protected):
    client, owner, profile_id, users = protected
    editor = users[0]
    token = authenticate(client, editor[0], editor[1]).json()["token"]
    writer = headers(token)
    path = f"/api/v1/profiles/{profile_id}/captures"
    for purpose in ("capture", "storage"):
        result = client.post(
            f"/api/v1/auth/profiles/{profile_id}/consents",
            headers=writer,
            json={"purpose": purpose, "version": "bv-synthetic-v1", "confirmed": True},
        )
        assert result.status_code == 200
    saved = client.post(
        path,
        content=_synthetic_png(),
        headers={**writer, "Content-Type": "image/png", "X-Synthetic-Only": "confirmed"},
    )
    assert saved.status_code == 201, saved.text
    image_id = saved.json()["id"]
    with owner.begin() as conn:
        conn.execute(
            text("""UPDATE synthetic_capture_objects
              SET created_at=now()-interval '8 days',
                  expires_at=now()-interval '1 day' WHERE id=:id"""),
            {"id": image_id},
        )
    assert client.get(f"{path}/{image_id}", headers=writer).status_code == 404
    assert client.get(path, headers=writer).json()["total"] == 0
    purged = client.post(f"{path}/purge-expired", headers=writer)
    assert purged.status_code == 200, purged.text
    assert purged.json() == {"deleted": 1, "batch_limit": 100, "limit_reached": False}
    assert client.delete(f"{path}/{image_id}", headers=writer).status_code == 404


def test_manual_capture_purge_is_bounded_scoped_and_audited(protected):
    """A private writer may purge <=100 expired records, never live or foreign ones."""
    import hashlib

    from sqlalchemy import text

    client, owner, profile_id, users = protected
    editor, reader, outsider = users[:3]
    writer = headers(authenticate(client, editor[0], editor[1]).json()["token"])
    readonly = headers(authenticate(client, reader[0], reader[1]).json()["token"])
    foreign = headers(authenticate(client, outsider[0], outsider[1]).json()["token"])
    path = f"/api/v1/profiles/{profile_id}/captures/purge-expired"
    assert client.post(path).status_code == 401
    assert client.post(path, headers=readonly).status_code == 403
    assert client.post(path, headers=foreign).status_code == 404

    png = _synthetic_png()
    encrypted = Fernet(Fernet.generate_key()).encrypt(png)
    identities = [(uuid4(), True) for _ in range(105)] + [(uuid4(), False), (uuid4(), False)]
    with owner.begin() as connection:
        connection.execute(
            text("""
                INSERT INTO synthetic_capture_objects(
                    id,organization_id,profile_id,created_by,original_bytes,
                    width,height,sha256_digest,ciphertext,created_at,expires_at
                ) VALUES(
                    :id,:org,:profile,:actor,:size,32,64,:digest,:cipher,
                    CASE WHEN :expired THEN now()-interval '8 days' ELSE now() END,
                    CASE WHEN :expired THEN now()-interval '1 day'
                        ELSE now()+interval '7 days' END
                )
            """),
            [
                {
                    "id": identity,
                    "org": FIRST_WORKSPACE,
                    "profile": profile_id,
                    "actor": editor[0],
                    "size": len(png),
                    "digest": hashlib.sha256(png).hexdigest(),
                    "cipher": encrypted,
                    "expired": expired,
                }
                for identity, expired in identities
            ],
        )
    results = []
    for _ in range(3):
        response = client.post(path, headers=writer)
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "no-store"
        results.append(response.json())
    assert results == [
        {"deleted": 100, "batch_limit": 100, "limit_reached": True},
        {"deleted": 5, "batch_limit": 100, "limit_reached": False},
        {"deleted": 0, "batch_limit": 100, "limit_reached": False},
    ]
    with owner.connect() as connection:
        survivors = (
            connection.execute(
                text("""
                SELECT id,ciphertext FROM synthetic_capture_objects
                 WHERE profile_id=:profile
            """),
                {"profile": profile_id},
            )
            .mappings()
            .all()
        )
        assert {row["id"] for row in survivors} == {identities[105][0], identities[106][0]}
        assert all(bytes(row["ciphertext"]) == encrypted for row in survivors)
        assert (
            connection.execute(
                text("""
                SELECT count(*) FROM security_audit_events
                 WHERE resource_id=:profile AND action='capture.purge'
            """),
                {"profile": profile_id},
            ).scalar_one()
            == 3
        )


def test_manual_capture_purge_rolls_back_if_audit_fails(protected):
    from sqlalchemy import event

    client, owner, profile_id, users = protected
    editor = users[0]
    writer = headers(authenticate(client, editor[0], editor[1]).json()["token"])
    path = f"/api/v1/profiles/{profile_id}/captures/purge-expired"
    png = _synthetic_png()
    capture = uuid4()
    with owner.begin() as connection:
        connection.execute(
            text("""
                INSERT INTO synthetic_capture_objects(
                    id,organization_id,profile_id,created_by,original_bytes,
                    width,height,sha256_digest,ciphertext,created_at,expires_at
                ) VALUES(
                    :id,:org,:profile,:actor,:size,32,64,:digest,:cipher,
                    now()-interval '8 days',now()-interval '1 day'
                )
            """),
            {
                "id": capture,
                "org": FIRST_WORKSPACE,
                "profile": profile_id,
                "actor": editor[0],
                "size": len(png),
                "digest": __import__("hashlib").sha256(png).hexdigest(),
                "cipher": Fernet(Fernet.generate_key()).encrypt(png),
            },
        )

    def deny_audit(conn, cursor, statement, parameters, context, executemany):
        if "audit_synthetic_capture" in statement:
            raise RuntimeError("synthetic audit failure")

    engine = client.app.state.engine
    event.listen(engine, "before_cursor_execute", deny_audit)
    try:
        response = client.post(path, headers=writer)
        assert response.status_code == 500
        assert "deleted" not in response.text
    finally:
        event.remove(engine, "before_cursor_execute", deny_audit)
    with owner.connect() as connection:
        assert (
            connection.execute(
                text("SELECT count(*) FROM synthetic_capture_objects WHERE id=:id"),
                {"id": capture},
            ).scalar_one()
            == 1
        )


def test_capture_key_rotation_is_atomic_and_never_exposes_old_keys(protected):
    import hashlib

    from pydantic import SecretStr

    client, owner, profile_id, users = protected
    editor, reader, outsider, admin = users
    editor_token = authenticate(client, editor[0], editor[1]).json()["token"]
    admin_token = authenticate(client, admin[0], admin[1]).json()["token"]
    writer, administrator = headers(editor_token), headers(admin_token)
    path = f"/api/v1/profiles/{profile_id}/captures"
    for purpose in ("capture", "storage"):
        assert (
            client.post(
                f"/api/v1/auth/profiles/{profile_id}/consents",
                headers=writer,
                json={"purpose": purpose, "version": "bv-synthetic-v1", "confirmed": True},
            ).status_code
            == 200
        )

    data = _synthetic_png()
    created = client.post(
        path,
        content=data,
        headers={**writer, "Content-Type": "image/png", "X-Synthetic-Only": "confirmed"},
    )
    assert created.status_code == 201, created.text
    capture_id = created.json()["id"]
    legacy = Fernet.generate_key()
    legacy_ciphertext = Fernet(legacy).encrypt(data)
    with owner.begin() as conn:
        conn.execute(
            text("""INSERT INTO profile_access(
              id,organization_id,profile_id,user_id,access_level
            ) VALUES (:id,:org,:profile,:user,'manage')"""),
            {
                "id": uuid4(),
                "org": FIRST_WORKSPACE,
                "profile": profile_id,
                "user": admin[0],
            },
        )
        conn.execute(
            text("UPDATE synthetic_capture_objects SET ciphertext=:ciphertext WHERE id=:id"),
            {"id": capture_id, "ciphertext": legacy_ciphertext},
        )

    settings = client.app.state.settings
    try:
        # Missing predecessor key: fail closed, no mutation.
        assert client.get(f"{path}/{capture_id}", headers=writer).status_code == 500
        missing = client.post(path + "/rotate-key", headers=administrator)
        assert missing.status_code == 409, missing.text
        assert missing.json()["code"] == "CAPTURE_KEY_UNAVAILABLE"
        with owner.connect() as conn:
            assert (
                bytes(
                    conn.execute(
                        text("SELECT ciphertext FROM synthetic_capture_objects WHERE id=:id"),
                        {"id": capture_id},
                    ).scalar_one()
                )
                == legacy_ciphertext
            )

        client.app.state.settings = settings.model_copy(
            update={"capture_decryption_keys": [SecretStr(legacy.decode())]}
        )
        assert client.get(f"{path}/{capture_id}", headers=writer).content == data
        assert client.post(path + "/rotate-key", headers=writer).status_code == 403
        rotated = client.post(path + "/rotate-key", headers=administrator)
        assert rotated.status_code == 200, rotated.text
        assert rotated.json() == {"examined": 1, "rotated": 1, "key_material_exposed": False}
        again = client.post(path + "/rotate-key", headers=administrator)
        assert again.status_code == 200
        assert again.json()["rotated"] == 0

        client.app.state.settings = settings
        assert client.get(f"{path}/{capture_id}", headers=writer).content == data
        with owner.connect() as conn:
            encrypted = bytes(
                conn.execute(
                    text("SELECT ciphertext FROM synthetic_capture_objects WHERE id=:id"),
                    {"id": capture_id},
                ).scalar_one()
            )
        primary = Fernet(settings.capture_encryption_key.get_secret_value().encode())
        assert primary.decrypt(encrypted) == data
        assert hashlib.sha256(data).hexdigest() == created.json()["sha256_digest"]

        # A digest mismatch must abort the update without losing the token.
        wrong = Fernet(legacy).encrypt(b"corrupt-fictional-pixels")
        with owner.begin() as conn:
            conn.execute(
                text("UPDATE synthetic_capture_objects SET ciphertext=:ciphertext WHERE id=:id"),
                {"id": capture_id, "ciphertext": wrong},
            )
        client.app.state.settings = settings.model_copy(
            update={"capture_decryption_keys": [SecretStr(legacy.decode())]}
        )
        invalid = client.post(path + "/rotate-key", headers=administrator)
        assert invalid.status_code == 409
        assert invalid.json()["code"] == "CAPTURE_INTEGRITY_FAILURE"
        with owner.connect() as conn:
            assert (
                bytes(
                    conn.execute(
                        text("SELECT ciphertext FROM synthetic_capture_objects WHERE id=:id"),
                        {"id": capture_id},
                    ).scalar_one()
                )
                == wrong
            )
    finally:
        client.app.state.settings = settings


def test_synthetic_capture_retention_deletes_only_expired_rows(protected):
    import hashlib

    from app.workers.capture_retention import purge_due

    client, owner, profile_id, users = protected
    editor = users[0]
    image = _synthetic_png()
    secret = Fernet.generate_key()
    expired_id, active_id = uuid4(), uuid4()
    entries = [
        (expired_id, True),
        (active_id, False),
    ]
    with owner.begin() as conn:
        for identifier, expired in entries:
            conn.execute(
                text("""INSERT INTO synthetic_capture_objects(
                  id,organization_id,profile_id,created_by,original_bytes,
                  width,height,sha256_digest,ciphertext,created_at,expires_at
                ) VALUES (
                  :id,:org,:profile,:actor,:size,32,64,:digest,:encrypted,
                  CASE WHEN :expired THEN now()-interval '8 days' ELSE now() END,
                  CASE WHEN :expired THEN now()-interval '1 day'
                       ELSE now()+interval '7 days' END
                )"""),
                {
                    "id": identifier,
                    "org": FIRST_WORKSPACE,
                    "profile": profile_id,
                    "actor": editor[0],
                    "size": len(image),
                    "digest": hashlib.sha256(image).hexdigest(),
                    "encrypted": Fernet(secret).encrypt(image),
                    "expired": expired,
                },
            )

    # A request-scoped tenant must not be able to run global cleanup.
    with owner.connect() as conn:
        with pytest.raises(DBAPIError):
            with conn.begin():
                conn.execute(text("SET LOCAL ROLE bodyvision_app"))
                conn.execute(
                    text("SELECT set_config('app.organization_id',:org,true)"),
                    {"org": str(FIRST_WORKSPACE)},
                )
                conn.execute(text("SELECT purge_expired_synthetic_capture_batch(100)"))
    assert purge_due(client.app.state.engine, batch_size=1, max_batches=3) == 1
    assert purge_due(client.app.state.engine, batch_size=1) == 0
    with owner.connect() as conn:
        remaining = (
            conn.execute(
                text("SELECT id FROM synthetic_capture_objects WHERE profile_id=:profile"),
                {"profile": profile_id},
            )
            .scalars()
            .all()
        )
        assert remaining == [active_id]
        assert (
            conn.execute(
                text("""SELECT count(*) FROM synthetic_capture_maintenance_events
              WHERE action='retention.purge' AND deleted_count=1"""),
            ).scalar_one()
            >= 1
        )

    # Simulate a stale snapshot row being reintroduced in this disposable DB.
    # This is a retention-replay test, not a database-provider restore drill.
    replay_id = uuid4()
    with owner.begin() as conn:
        conn.execute(
            text("""INSERT INTO synthetic_capture_objects(
                id,organization_id,profile_id,created_by,original_bytes,
                width,height,sha256_digest,ciphertext,created_at,expires_at
            ) VALUES (
                :id,:org,:profile,:actor,:size,32,64,:digest,:encrypted,
                now()-interval '8 days',now()-interval '1 day'
            )"""),
            {
                "id": replay_id,
                "org": FIRST_WORKSPACE,
                "profile": profile_id,
                "actor": editor[0],
                "size": len(image),
                "digest": hashlib.sha256(image).hexdigest(),
                "encrypted": Fernet(secret).encrypt(image),
            },
        )
    assert purge_due(client.app.state.engine, batch_size=1) == 1
    with owner.connect() as conn:
        retained = (
            conn.execute(
                text("SELECT id FROM synthetic_capture_objects WHERE profile_id=:profile"),
                {"profile": profile_id},
            )
            .scalars()
            .all()
        )
        assert retained == [active_id]
