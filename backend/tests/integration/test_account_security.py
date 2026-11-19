"""Account lifecycle and audit integrity against disposable PostgreSQL."""

from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from sqlalchemy import text
from test_authenticated_api import PASSWORD, authenticate, headers
from test_authenticated_api import protected as protected

NEW_PASSWORD = "Changed synthetic passphrase 2026!"
CONFIRMATION = {"current_password": PASSWORD}
CHANGE = {**CONFIRMATION, "new_password": NEW_PASSWORD}


def test_session_directory_is_own_only_paginated_and_never_contains_tokens(protected):
    client, _, _, users = protected
    token = authenticate(client, *users[0][:2]).json()["token"]
    authenticate(client, *users[0][:2])
    authenticate(client, *users[1][:2])
    authenticate(client, *users[2][:2])
    result = client.get("/api/v1/auth/sessions?limit=1", headers=headers(token))
    assert result.status_code == 200
    first = result.json()
    assert first["total"] == 2 and first["items"][0]["current"]
    assert len(first["items"]) == 1
    assert set(first["items"][0]) == {"id", "issued_at", "expires_at", "current"}
    assert token not in result.text and "token_sha256" not in result.text
    second = client.get("/api/v1/auth/sessions?limit=1&offset=1", headers=headers(token)).json()
    assert second["total"] == 2 and not second["items"][0]["current"]
    assert client.get("/api/v1/auth/sessions").status_code == 401
    assert (
        client.get(
            "/api/v1/auth/sessions", headers={**headers(token), "X-Workspace-ID": str(users[2][1])}
        ).status_code
        == 400
    )


def test_session_revocation_is_scoped_to_owner_and_can_end_current_session(protected):
    client, _, _, users = protected
    token = authenticate(client, *users[0][:2]).json()["token"]
    other_token = authenticate(client, *users[0][:2]).json()["token"]
    foreign = authenticate(client, *users[1][:2]).json()["token"]
    own = client.get("/api/v1/auth/sessions", headers=headers(token)).json()["items"]
    foreign_id = client.get("/api/v1/auth/sessions", headers=headers(foreign)).json()["items"][0][
        "id"
    ]
    foreign_attempt = client.post(
        f"/api/v1/auth/sessions/{foreign_id}/revoke", headers=headers(token), json=CONFIRMATION
    )
    assert foreign_attempt.status_code == 404
    assert client.get("/api/v1/auth/me", headers=headers(foreign)).status_code == 200
    target = next(item["id"] for item in own if not item["current"])
    path = f"/api/v1/auth/sessions/{target}/revoke"
    result = client.post(path, headers=headers(token), json=CONFIRMATION)
    assert result.json() == {"status": "revoked", "revoked_sessions": 1, "current_revoked": False}
    assert client.get("/api/v1/auth/me", headers=headers(other_token)).status_code == 401
    assert client.get("/api/v1/auth/me", headers=headers(token)).status_code == 200
    assert client.post(path, headers=headers(token), json=CONFIRMATION).status_code == 404
    current_id = next(item["id"] for item in own if item["current"])
    current = client.post(
        f"/api/v1/auth/sessions/{current_id}/revoke", headers=headers(token), json=CONFIRMATION
    )
    assert current.json()["current_revoked"]
    assert client.get("/api/v1/auth/me", headers=headers(token)).status_code == 401


def test_revoke_all_ends_all_own_sessions_but_preserves_other_accounts(protected):
    client, _, _, users = protected
    first = authenticate(client, *users[1][:2]).json()["token"]
    second = authenticate(client, *users[1][:2]).json()["token"]
    editor = authenticate(client, *users[0][:2]).json()["token"]
    result = client.post(
        "/api/v1/auth/sessions/revoke-all", headers=headers(first), json=CONFIRMATION
    )
    assert result.status_code == 200 and result.json()["revoked_sessions"] == 2
    assert result.json()["current_revoked"]
    for token in (first, second):
        assert client.get("/api/v1/auth/me", headers=headers(token)).status_code == 401
    assert client.get("/api/v1/auth/me", headers=headers(editor)).status_code == 200
    assert authenticate(client, *users[1][:2]).status_code == 200


@pytest.mark.parametrize("index", [0, 1, 3])
def test_own_password_change_revokes_sessions_and_preserves_role_and_grants(protected, index):
    client, owner, profile, users = protected
    user = users[index]
    first = authenticate(client, *user[:2]).json()["token"]
    second = authenticate(client, *user[:2]).json()["token"]
    with owner.connect() as connection:
        old_verifier = connection.execute(
            text("SELECT password_hash FROM users WHERE id=:id"), {"id": user[0]}
        ).scalar_one()
    result = client.post("/api/v1/auth/password", headers=headers(first), json=CHANGE)
    assert result.status_code == 200 and result.json()["revoked_sessions"] == 2
    assert result.json()["current_revoked"] and NEW_PASSWORD not in result.text
    for token in (first, second):
        assert client.get("/api/v1/auth/me", headers=headers(token)).status_code == 401
    assert authenticate(client, *user[:2]).status_code == 401
    replacement = client.post(
        "/api/v1/auth/login",
        json={
            "organization_id": str(user[1]),
            "email": f"fictional-{user[0].hex[:12]}@example.invalid",
            "password": NEW_PASSWORD,
        },
    )
    assert replacement.status_code == 200 and replacement.json()["role"] == user[2]
    expected_access = 404 if index == 3 else 200
    assert (
        client.get(
            f"/api/v1/profiles/{profile}", headers=headers(replacement.json()["token"])
        ).status_code
        == expected_access
    )
    # Even a caller which verified the old password before this change cannot
    # issue a session afterwards. The SQL function rechecks under the user lock.
    with owner.begin() as connection:
        assert (
            connection.execute(
                text("SELECT issue_private_session(:org,:user,:old,:id,CAST(:digest AS char(64)))"),
                {
                    "org": user[1],
                    "user": user[0],
                    "old": old_verifier,
                    "id": uuid4(),
                    "digest": "1" * 64,
                },
            ).scalar_one()
            is None
        )


def test_own_confirmation_throttle_commits_denials_and_cannot_be_bypassed_with_subject(protected):
    client, owner, _, users = protected
    token = authenticate(client, *users[1][:2]).json()["token"]
    assert (
        client.post(
            "/api/v1/auth/password",
            headers=headers(token),
            json={
                **CHANGE,
                "user_id": str(users[0][0]),
            },
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/auth/password",
            headers=headers(token),
            json={
                **CONFIRMATION,
                "new_password": PASSWORD,
            },
        ).status_code
        == 422
    )
    for _ in range(5):
        denied = client.post(
            "/api/v1/auth/password",
            headers=headers(token),
            json={
                "current_password": "Wrong",
                "new_password": NEW_PASSWORD,
            },
        )
        assert denied.status_code == 403 and denied.json()["code"] == "SELF_REAUTH_REQUIRED"
    blocked = client.post(
        "/api/v1/auth/sessions/revoke-all", headers=headers(token), json=CONFIRMATION
    )
    assert blocked.status_code == 429 and blocked.json()["code"] == "SELF_RATE_LIMITED"
    assert authenticate(client, *users[1][:2]).status_code == 200
    with owner.connect() as connection:
        assert (
            connection.execute(
                text(
                    "SELECT count(*) FROM security_audit_events WHERE actor_id=:id "
                    "AND action='account.password_change_denied'"
                ),
                {"id": users[1][0]},
            ).scalar_one()
            == 5
        )


def test_password_change_and_chain_head_roll_back_if_audit_fails(protected):
    client, owner, _, users = protected
    token = authenticate(client, *users[0][:2]).json()["token"]
    admin = authenticate(client, *users[3][:2]).json()["token"]
    with owner.connect() as connection:
        before = connection.execute(
            text(
                "SELECT last_sequence,last_hash FROM private_audit_heads WHERE organization_id=:org"
            ),
            {"org": users[0][1]},
        ).one()
    try:
        with owner.begin() as connection:
            connection.execute(
                text("""
                CREATE FUNCTION test_own_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF NEW.action='account.password_change' THEN
                  RAISE EXCEPTION 'Synthetic failure'; END IF; RETURN NEW; END $$;
                CREATE TRIGGER test_own_audit_failure BEFORE INSERT ON security_audit_events
                  FOR EACH ROW EXECUTE FUNCTION test_own_audit_failure();
            """)
            )
        assert (
            client.post("/api/v1/auth/password", headers=headers(token), json=CHANGE).status_code
            == 500
        )
        assert client.get("/api/v1/auth/me", headers=headers(token)).status_code == 200
        with owner.connect() as connection:
            after = connection.execute(
                text(
                    "SELECT last_sequence,last_hash FROM private_audit_heads "
                    "WHERE organization_id=:org"
                ),
                {"org": users[0][1]},
            ).one()
        assert before == after
        assert client.post("/api/v1/auth/audit/verify", headers=headers(admin)).json()["valid"]
        assert authenticate(client, *users[0][:2]).status_code == 200
    finally:
        with owner.begin() as connection:
            connection.execute(
                text(
                    "DROP TRIGGER IF EXISTS test_own_audit_failure ON security_audit_events; "
                    "DROP FUNCTION IF EXISTS test_own_audit_failure()"
                )
            )


@pytest.mark.parametrize("tamper", ["action", "timestamp", "middle", "tail"])
def test_audit_chain_detects_owner_level_tampering_and_missing_tail(protected, tamper):
    client, owner, _, users = protected
    token = authenticate(client, *users[3][:2]).json()["token"]
    authenticate(client, *users[1][:2])
    verified = client.post("/api/v1/auth/audit/verify", headers=headers(token))
    assert verified.status_code == 200 and verified.json()["valid"]
    assert verified.json()["checked_events"] == 2
    assert len(verified.json()["checkpoint_hash"]) == 64
    with owner.begin() as connection:
        if tamper in {"middle", "tail"}:
            sequence = 2 if tamper == "middle" else 3
            connection.execute(
                text(
                    "DELETE FROM security_audit_events "
                    "WHERE organization_id=:org AND chain_sequence=:seq"
                ),
                {"org": users[3][1], "seq": sequence},
            )
        else:
            assignment = (
                "action='tampered'"
                if tamper == "action"
                else "happened_at=happened_at-interval '1 second'"
            )
            connection.execute(
                text(
                    f"UPDATE security_audit_events SET {assignment} "
                    "WHERE organization_id=:org AND chain_sequence=1"
                ),
                {"org": users[3][1]},
            )
    detected = client.post("/api/v1/auth/audit/verify", headers=headers(token)).json()
    assert not detected["valid"] and detected["first_invalid_sequence"] is not None


def test_chain_is_serialized_per_org_and_verification_is_admin_only(protected):
    client, owner, _, users = protected
    admin = authenticate(client, *users[3][:2]).json()["token"]
    outsider = authenticate(client, *users[2][:2]).json()["token"]
    assert client.post("/api/v1/auth/audit/verify", headers=headers(outsider)).status_code == 403
    assert client.post("/api/v1/auth/audit/verify").status_code == 401

    def append(index):
        with owner.begin() as connection:
            connection.execute(
                text("""
                INSERT INTO security_audit_events(
                  id,organization_id,actor_id,correlation_id,action,resource_type,outcome,happened_at
                ) VALUES(:id,:org,:actor,:correlation,'test.concurrent','session','allowed',
                  now()-make_interval(days=>:days))
            """),
                {
                    "id": uuid4(),
                    "org": users[3][1],
                    "actor": users[3][0],
                    "correlation": uuid4(),
                    "days": index,
                },
            )

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(append, range(8)))
    # A changed event in another tenant does not affect this tenant's chain.
    with owner.begin() as connection:
        connection.execute(
            text("UPDATE security_audit_events SET action='tampered' WHERE organization_id=:org"),
            {"org": users[2][1]},
        )
    result = client.post("/api/v1/auth/audit/verify", headers=headers(admin)).json()
    assert result["valid"] and result["checked_events"] == 9
    assert result["checkpoint_sequence"] == 9
