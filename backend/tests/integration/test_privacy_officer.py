"""Minimum-data privacy role on PostgreSQL, with real TOTP/session transitions."""

import secrets
from datetime import UTC, datetime
from urllib.parse import parse_qs, urlparse
from uuid import UUID, uuid4

import pytest
from pydantic import SecretStr
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from test_authenticated_api import PASSWORD, authenticate, headers
from test_authenticated_api import protected as protected
from test_mfa_step_up import _credentials, _enable_mfa

from app.core.identity import hash_session_token
from app.core.mfa import totp_code


@pytest.fixture(autouse=True)
def remove_disposable_observations(protected):
    """Owner-only fixture teardown, before the parent removes its expediente."""
    yield
    _, owner, profile, _ = protected
    with owner.begin() as conn:
        conn.execute(text("ALTER TABLE measurements DISABLE TRIGGER immutable_measurements"))
        conn.execute(text("DELETE FROM measurements WHERE profile_id=:p"), {"p": profile})
        conn.execute(text("ALTER TABLE measurements ENABLE TRIGGER immutable_measurements"))


def enroll(client, credentials, clock):
    started = client.post("/api/v1/auth/mfa/enrollment", json=credentials)
    assert started.status_code == 200, started.text
    seed = parse_qs(urlparse(started.json()["otpauth_uri"]).query)["secret"][0]
    result = client.post(
        "/api/v1/auth/mfa/confirm",
        json={**credentials, "code": totp_code(seed, clock[0])},
    )
    assert result.status_code == 200, result.text
    return seed, result.json()


def make_officer(owner, user):
    with owner.begin() as conn:
        conn.execute(
            text("UPDATE user_role_assignments SET role='privacy_officer' WHERE user_id=:user"),
            {"user": user[0]},
        )


def test_officer_scoped_queue_consents_and_sql_clinical_denial(protected, monkeypatch):
    client, owner, profile, users = protected
    editor, member = [
        headers(authenticate(client, *user[:2]).json()["token"]) for user in users[:2]
    ]
    root = f"/api/v1/profiles/{profile}"
    first = client.post(
        root + "/privacy-requests",
        headers=member,
        json={"request_type": "access", "synthetic_confirmed": True},
    )
    second = client.post(
        root + "/privacy-requests",
        headers=editor,
        json={"request_type": "export", "synthetic_confirmed": True},
    )
    assert first.status_code == second.status_code == 201
    consent_path = f"/api/v1/auth/profiles/{profile}/consents"
    consent = client.post(
        consent_path,
        headers=editor,
        json={"purpose": "capture", "version": "bv-synthetic-v1", "confirmed": True},
    )
    assert consent.status_code == 200, consent.text
    consent_id = consent.json()["items"][0]["id"]
    with owner.begin() as conn:
        conn.execute(
            text("""INSERT INTO measurements
          (id,organization_id,profile_id,metric_code,value,unit,method,measured_at,created_by)
          VALUES (:id,:org,:profile,'weight',72,'kg','manual',:at,:actor)"""),
            {
                "id": uuid4(),
                "org": users[0][1],
                "profile": profile,
                "at": datetime.now(UTC),
                "actor": users[0][0],
            },
        )
    make_officer(owner, users[1])
    # An old one-factor bearer must not acquire the newly assigned role.
    assert client.get("/api/v1/privacy-requests", headers=member).status_code == 401
    assert authenticate(client, *users[1][:2]).status_code == 403
    clock = _enable_mfa(client, monkeypatch)
    assert authenticate(client, *users[1][:2]).status_code == 428
    _, account = enroll(client, _credentials(users[1]), clock)
    auth = headers(account["token"])
    assert account["role"] == "privacy_officer"
    queue = client.get("/api/v1/privacy-requests", headers=auth)
    assert queue.status_code == 200, queue.text
    assert queue.json()["total"] == 2
    assert all(not row["can_review"] for row in queue.json()["items"])
    assert {row["id"] for row in queue.json()["items"]} == {first.json()["id"], second.json()["id"]}
    assert all(
        "birth_year" not in row and "display_name" not in row for row in queue.json()["items"]
    )
    review = f"/api/v1/privacy-requests/{first.json()['id']}/review"
    assert client.post(review, headers=auth).status_code == 404  # read grant only
    history = client.get(consent_path, headers=auth)
    assert history.status_code == 200
    assert history.json()["can_record"] is history.json()["can_revoke"] is False
    assert client.post(consent_path + f"/{consent_id}/revoke", headers=auth).status_code == 403

    with owner.begin() as conn:
        conn.execute(
            text(
                "UPDATE profile_access SET access_level='write' WHERE profile_id=:p AND user_id=:u"
            ),
            {"p": profile, "u": users[1][0]},
        )
    assert client.post(review, headers=auth).status_code == 404
    assert client.get(consent_path, headers=auth).json()["can_revoke"] is False
    with owner.begin() as conn:
        conn.execute(
            text(
                "UPDATE profile_access SET access_level='manage' WHERE profile_id=:p AND user_id=:u"
            ),
            {"p": profile, "u": users[1][0]},
        )
    reviewed = client.post(review, headers=auth)
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["can_review"] is True
    assert (
        client.post(
            consent_path,
            headers=auth,
            json={"purpose": "pose", "version": "bv-synthetic-v1", "confirmed": True},
        ).status_code
        == 403
    )
    revoked = client.post(consent_path + f"/{consent_id}/revoke", headers=auth)
    assert revoked.status_code == 200, revoked.text
    assert revoked.json()["can_record"] is False
    assert revoked.json()["can_revoke"] is True
    assert revoked.json()["items"][0]["status"] == "revoked"
    for path in (
        "/api/v1/profiles",
        root,
        root + "/measurements",
        root + "/captures",
        root + "/scenarios",
        root + "/pose-summaries",
        root + "/privacy-requests",
        "/api/v1/auth/users",
        "/api/v1/auth/audit",
        "/api/v1/auth/operations",
    ):
        assert client.get(path, headers=auth).status_code == 403, path
    assert (
        client.post(
            "/api/v1/profiles", headers=auth, json={"birth_year": 1995, "display_name": "Forbidden"}
        ).status_code
        == 403
    )

    with owner.begin() as conn:
        conn.execute(text("SET LOCAL ROLE bodyvision_app"))
        for name, value in {
            "organization_id": str(users[1][1]),
            "actor_id": str(users[1][0]),
            "identity_verified": "yes",
            "session_digest": hash_session_token(account["token"]),
        }.items():
            conn.execute(
                text("SELECT set_config(:name,:value,true)"),
                {"name": "app." + name, "value": value},
            )
        # Actual populated clinical tables are denied despite the manage grant.
        for table in ("profiles", "measurements", "users"):
            assert conn.execute(text(f"SELECT count(*) FROM {table}")).scalar_one() == 0
        assert (
            conn.execute(text("SELECT count(*) FROM private_privacy_profile_labels()")).scalar_one()
            == 1
        )
        assert (
            conn.execute(text("SELECT count(*) FROM synthetic_privacy_requests")).scalar_one() == 2
        )
        conn.execute(text("SELECT set_config('app.session_digest','',true)"))
        assert (
            conn.execute(text("SELECT count(*) FROM synthetic_privacy_requests")).scalar_one() == 0
        )
        assert (
            conn.execute(text("SELECT count(*) FROM private_privacy_profile_labels()")).scalar_one()
            == 0
        )
        with pytest.raises(DBAPIError) as denied, conn.begin_nested():
            conn.execute(
                text("""INSERT INTO profiles
              (id,organization_id,display_code,birth_year,created_by)
              VALUES (:id,:org,'NO-CLINICAL',1999,:actor)"""),
                {"id": uuid4(), "org": users[1][1], "actor": users[1][0]},
            )
        assert denied.value.orig.sqlstate == "42501"
    with owner.begin() as conn:
        conn.execute(
            text("DELETE FROM profile_access WHERE profile_id=:p AND user_id=:u"),
            {"p": profile, "u": users[1][0]},
        )
    assert client.get("/api/v1/privacy-requests", headers=auth).json()["total"] == 0
    assert client.get(consent_path, headers=auth).status_code == 404
    assert client.post(review, headers=auth).status_code == 404


def test_officer_provisioning_and_management_require_admin_mfa(protected, monkeypatch):
    client, _, profile, users = protected
    admin = headers(authenticate(client, *users[3][:2]).json()["token"])
    body = {
        "display_name": "Privacidad ficticia",
        "email": "privacy.fixture@example.invalid",
        "password": PASSWORD,
        "role": "privacy_officer",
    }
    assert client.post("/api/v1/auth/users", headers=admin, json=body).status_code == 409
    clock = _enable_mfa(client, monkeypatch)
    _, administrator = enroll(client, _credentials(users[3]), clock)
    admin = headers(administrator["token"])
    created = client.post("/api/v1/auth/users", headers=admin, json=body)
    assert created.status_code == 201, created.text
    officer = created.json()
    users.append((UUID(officer["id"]), users[3][1], "privacy_officer", None))
    credentials = {
        "organization_id": str(users[3][1]),
        "email": body["email"],
        "password": PASSWORD,
    }
    assert client.post("/api/v1/auth/login", json=credentials).status_code == 428
    _, account = enroll(client, credentials, clock)
    assert (
        client.get("/api/v1/privacy-requests", headers=headers(account["token"])).json()["total"]
        == 0
    )
    directory = client.get("/api/v1/auth/users?limit=50", headers=admin)
    entry = next(row for row in directory.json()["items"] if row["id"] == officer["id"])
    assert entry["role"] == "privacy_officer" and entry["manageable"] is True
    grant = {"profile_id": str(profile), "user_id": officer["id"], "access_level": "write"}
    assert (
        client.post("/api/v1/auth/profile-access/grant", headers=admin, json=grant).status_code
        == 404
    )
    assert (
        client.post(
            "/api/v1/auth/profile-access/grant",
            headers=admin,
            json={**grant, "access_level": "manage"},
        ).status_code
        == 200
    )
    disabled = client.post(
        f"/api/v1/auth/users/{officer['id']}/status",
        headers=admin,
        json={"status": "disabled", "administrator_password": PASSWORD},
    )
    assert disabled.status_code == 200, disabled.text
    assert client.get("/api/v1/auth/me", headers=headers(account["token"])).status_code == 401


def test_officer_jwt_rotation_recovery_and_role_expiration(protected, monkeypatch):
    client, owner, _, users = protected
    make_officer(owner, users[1])
    clock = _enable_mfa(client, monkeypatch)
    credentials = _credentials(users[1])
    _, account = enroll(client, credentials, clock)
    settings = client.app.state.settings
    settings.jwt_access_enabled = True
    settings.jwt_signing_key = SecretStr(secrets.token_urlsafe(32))
    exchanged = client.post("/api/v1/auth/access/exchange", headers=headers(account["token"]))
    assert exchanged.status_code == 200, exchanged.text
    jwt = exchanged.json()["access_token"]
    assert exchanged.json()["role"] == "privacy_officer"
    assert client.get("/api/v1/privacy-requests", headers=headers(jwt)).status_code == 200
    rotated = client.post("/api/v1/auth/sessions/rotate", headers=headers(account["token"]))
    assert rotated.status_code == 200, rotated.text
    assert rotated.json()["role"] == "privacy_officer"
    assert client.get("/api/v1/privacy-requests", headers=headers(jwt)).status_code == 401
    recovered = client.post(
        "/api/v1/auth/login", json={**credentials, "mfa_code": account["recovery_codes"][0]}
    )
    assert recovered.status_code == 200, recovered.text
    assert (
        client.post(
            "/api/v1/auth/login", json={**credentials, "mfa_code": account["recovery_codes"][0]}
        ).status_code
        == 401
    )
    auth = headers(recovered.json()["token"])
    replacement = client.post(
        "/api/v1/auth/mfa/recover",
        json={**credentials, "recovery_code": account["recovery_codes"][1]},
    )
    assert replacement.status_code == 200, replacement.text
    seed = parse_qs(urlparse(replacement.json()["otpauth_uri"]).query)["secret"][0]
    confirmed = client.post(
        "/api/v1/auth/mfa/confirm", json={**credentials, "code": totp_code(seed, clock[0])}
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["role"] == "privacy_officer"
    assert client.get("/api/v1/privacy-requests", headers=auth).status_code == 401
    auth = headers(confirmed.json()["token"])
    with owner.begin() as conn:
        conn.execute(
            text(
                "UPDATE user_role_assignments SET expires_at=now()-interval '1 second' "
                "WHERE user_id=:u"
            ),
            {"u": users[1][0]},
        )
    assert client.get("/api/v1/privacy-requests", headers=auth).status_code == 401
