"""End-to-end synthetic invitation and permission boundaries in PostgreSQL."""

import secrets
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from pydantic import SecretStr
from sqlalchemy import text
from test_authenticated_api import PASSWORD, authenticate, headers
from test_authenticated_api import protected as protected

from app.core.identity import hash_session_token

ROOT = "/api/v1/auth/invitations"
INVITEE_PASSWORD = "Synthetic invitation password 2026!"


def invite(client, bearer, email, role="member", name="Invitado ficticio"):
    return client.post(
        ROOT,
        headers=headers(bearer),
        json={
            "email": email,
            "display_name": name,
            "role": role,
            "administrator_password": PASSWORD,
        },
    )


def accept(client, token, password=INVITEE_PASSWORD):
    return client.post(ROOT + "/accept", json={"token": token, "password": password})


def test_invite_accept_role_assignment_and_no_implicit_profile_access(protected):
    client, owner, profile, users = protected
    admin = authenticate(client, *users[3][:2]).json()["token"]
    member = authenticate(client, *users[1][:2]).json()["token"]
    specialist = authenticate(client, *users[0][:2]).json()["token"]
    email = f"invited-{uuid4().hex[:12]}@example.invalid"

    assert invite(client, member, email).status_code == 403
    assert invite(client, specialist, email).status_code == 403
    assert invite(client, "A" * 43, email).status_code == 401
    assert client.get(ROOT, headers=headers(member)).status_code == 403
    assert (
        client.post(
            ROOT,
            headers=headers(admin),
            json={
                "email": email,
                "display_name": "Invitado",
                "role": "administrator",
                "administrator_password": PASSWORD,
            },
        ).status_code
        == 422
    )
    rejected = client.post(
        ROOT,
        headers=headers(admin),
        json={
            "email": email,
            "display_name": "Invitado",
            "role": "member",
            "administrator_password": "wrong password",
        },
    )
    assert rejected.status_code == 403

    issued = invite(client, admin, email)
    assert issued.status_code == 201, issued.text
    secret = issued.json()["token"]
    assert len(secret) == 43
    assert issued.json()["role"] == "member"
    with owner.connect() as conn:
        row = conn.execute(
            text(
                "SELECT token_sha256,accepted_at,expires_at FROM "
                "synthetic_user_invitations WHERE id=:id"
            ),
            {"id": issued.json()["id"]},
        ).one()
        assert row.token_sha256 == hash_session_token(secret)
        assert row.accepted_at is None
        assert row.expires_at > conn.execute(text("SELECT clock_timestamp()")).scalar_one()
        for role in ("bodyvision_app", "bodyvision_auth_app"):
            assert not conn.execute(
                text(
                    "SELECT has_table_privilege(:role,'public.synthetic_user_invitations','SELECT')"
                ),
                {"role": role},
            ).scalar_one()

    listing = client.get(ROOT, headers=headers(admin))
    assert listing.status_code == 200, listing.text
    assert listing.json()["total"] >= 1
    row = next(x for x in listing.json()["items"] if x["id"] == issued.json()["id"])
    assert row["status"] == "pending"
    assert "token" not in listing.text
    assert secret not in listing.text
    assert hash_session_token(secret) not in listing.text
    assert invite(client, admin, email).status_code == 409

    assert accept(client, secrets.token_urlsafe(32)).status_code == 401
    accepted = accept(client, secret)
    assert accepted.status_code == 201, accepted.text
    assert accepted.json()["role"] == "member"
    assert accepted.json()["organization_id"] == str(users[3][1])
    user_id = accepted.json()["user_id"]
    assert accept(client, secret).status_code == 401
    assert "token" not in accepted.text

    login = client.post(
        "/api/v1/auth/login",
        json={
            "organization_id": str(users[3][1]),
            "email": email,
            "password": INVITEE_PASSWORD,
        },
    )
    assert login.status_code == 200, login.text
    assert login.json()["role"] == "member"
    new_session = login.json()["token"]
    no_grant = client.get(f"/api/v1/profiles/{profile}", headers=headers(new_session))
    assert no_grant.status_code == 404
    assert client.patch(
        f"/api/v1/profiles/{profile}",
        headers=headers(new_session),
        json={"display_name": "Unauthorized edit"},
    ).status_code in {403, 404}
    with owner.connect() as conn:
        assert (
            conn.execute(
                text("SELECT count(*) FROM profile_access WHERE user_id=:user"),
                {"user": user_id},
            ).scalar_one()
            == 0
        )
        actions = (
            conn.execute(
                text(
                    "SELECT action FROM security_audit_events "
                    "WHERE actor_id IN (:admin,:user) "
                    "AND action IN ('admin.invitation_created','auth.invitation_accepted')"
                ),
                {"admin": users[3][0], "user": user_id},
            )
            .scalars()
            .all()
        )
        assert "admin.invitation_created" in actions
        assert "auth.invitation_accepted" in actions


def test_invitation_revoke_expire_and_tenant_isolation(protected):
    client, owner, _, users = protected
    admin = authenticate(client, *users[3][:2]).json()["token"]
    foreign = authenticate(client, *users[2][:2]).json()["token"]
    email = f"invited-{uuid4().hex[:12]}@example.invalid"
    created = invite(client, admin, email, role="specialist")
    assert created.status_code == 201, created.text
    invite_id = created.json()["id"]
    token = created.json()["token"]

    assert client.get(ROOT, headers=headers(foreign)).status_code == 403
    assert client.post(f"{ROOT}/{invite_id}/revoke", headers=headers(foreign)).status_code == 403
    assert (
        client.post(
            f"{ROOT}/{invite_id}/revoke",
            headers={**headers(admin), "X-Workspace-ID": str(users[2][1])},
        ).status_code
        == 400
    )

    revoked = client.post(f"{ROOT}/{invite_id}/revoke", headers=headers(admin))
    assert revoked.status_code == 200, revoked.text
    assert revoked.json()["status"] == "revoked"
    assert client.post(f"{ROOT}/{invite_id}/revoke", headers=headers(admin)).status_code == 404
    assert accept(client, token).status_code == 401

    renewed = invite(client, admin, email, role="specialist")
    assert renewed.status_code == 201, renewed.text
    with owner.begin() as conn:
        conn.execute(
            text(
                "UPDATE synthetic_user_invitations "
                "SET created_at=clock_timestamp()-interval '49 hours',"
                " expires_at=clock_timestamp()-interval '1 hour' "
                "WHERE id=:id"
            ),
            {"id": renewed.json()["id"]},
        )
    assert accept(client, renewed.json()["token"]).status_code == 401
    third = invite(client, admin, email, role="specialist")
    assert third.status_code == 201, third.text
    third_token = third.json()["token"]
    assert third_token not in renewed.text
    assert accept(client, third_token).status_code == 201
    assert client.get(ROOT, headers=headers(admin)).json()["total"] >= 3


def test_concurrent_redeem_consume_token_once(protected):
    client, owner, _, users = protected
    admin = authenticate(client, *users[3][:2]).json()["token"]
    email = f"invited-{uuid4().hex[:12]}@example.invalid"
    created = invite(client, admin, email)
    assert created.status_code == 201, created.text
    token = created.json()["token"]

    with ThreadPoolExecutor(max_workers=2) as executor:
        result = list(executor.map(lambda _: accept(client, token).status_code, range(2)))
    assert sorted(result) == [201, 401]
    with owner.connect() as conn:
        assert (
            conn.execute(
                text("SELECT count(*) FROM users WHERE organization_id=:org AND email=:email"),
                {"org": users[3][1], "email": email},
            ).scalar_one()
            == 1
        )


def test_invitation_creation_and_redemption_work_with_revocation_checked_jwt(protected):
    client, _, _, users = protected
    client.app.state.settings = client.app.state.settings.model_copy(
        update={
            "jwt_access_enabled": True,
            "jwt_signing_key": SecretStr(secrets.token_urlsafe(32)),
        }
    )
    admin = authenticate(client, *users[3][:2]).json()["token"]
    exchanged = client.post("/api/v1/auth/access/exchange", headers=headers(admin))
    assert exchanged.status_code == 200, exchanged.text
    jwt = exchanged.json()["access_token"]
    email = f"invited-{uuid4().hex[:12]}@example.invalid"
    issued = invite(client, jwt, email)
    assert issued.status_code == 201, issued.text
    assert accept(client, issued.json()["token"]).status_code == 201
    assert client.post("/api/v1/auth/logout", headers=headers(admin)).status_code == 204
    assert client.get(ROOT, headers=headers(jwt)).status_code == 401
