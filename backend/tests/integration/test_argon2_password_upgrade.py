"""Real PostgreSQL legacy migration, guarded by completed session authentication."""

from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import text
from test_authenticated_api import PASSWORD, authenticate, headers
from test_authenticated_api import protected as protected
from test_mfa_step_up import _credentials, _enable_mfa

from app.core.identity import _hash_legacy_secret, verify_password
from app.core.mfa import totp_code


def legacy_account(owner, user):
    verifier = _hash_legacy_secret(PASSWORD)
    with owner.begin() as conn:
        conn.execute(
            text("UPDATE users SET password_hash=:hash WHERE id=:id"),
            {"hash": verifier, "id": user[0]},
        )
    return verifier


def stored(owner, user):
    with owner.connect() as conn:
        return conn.execute(
            text("SELECT password_hash FROM users WHERE id=:id"), {"id": user[0]}
        ).scalar_one()


def rehash_count(owner, user):
    with owner.connect() as conn:
        return conn.execute(
            text(
                "SELECT count(*) FROM security_audit_events "
                "WHERE resource_id=:id AND action='auth.password_rehashed'"
            ),
            {"id": user[0]},
        ).scalar_one()


def test_legacy_login_upgrades_once_with_audit_and_preserves_existing_sessions(protected):
    client, owner, _, users = protected
    user = users[1]
    previous = authenticate(client, *user[:2]).json()["token"]
    legacy = legacy_account(owner, user)
    accepted = authenticate(client, *user[:2])
    assert accepted.status_code == 200, accepted.text
    current = stored(owner, user)
    assert current.startswith("$argon2id$") and current != legacy
    assert verify_password(PASSWORD, current)
    assert rehash_count(owner, user) == 1
    assert client.get("/api/v1/auth/me", headers=headers(previous)).status_code == 200
    assert authenticate(client, *user[:2]).status_code == 200
    assert rehash_count(owner, user) == 1


def test_wrong_password_never_upgrades_or_issues_a_session(protected):
    client, owner, _, users = protected
    user = users[1]
    legacy = legacy_account(owner, user)
    rejected = client.post("/api/v1/auth/login", json={**_credentials(user), "password": "wrong"})
    assert rejected.status_code == 401
    assert "token" not in rejected.json()
    assert stored(owner, user) == legacy and rehash_count(owner, user) == 0


def test_legacy_mfa_requires_success_before_upgrade_and_keeps_old_recovery_codes(
    protected, monkeypatch
):
    client, owner, _, users = protected
    clock = _enable_mfa(client, monkeypatch)
    user = users[0]
    credentials = _credentials(user)
    enrollment = client.post("/api/v1/auth/mfa/enrollment", json=credentials)
    seed = parse_qs(urlparse(enrollment.json()["otpauth_uri"]).query)["secret"][0]
    confirmed = client.post(
        "/api/v1/auth/mfa/confirm", json={**credentials, "code": totp_code(seed, clock[0])}
    )
    assert confirmed.status_code == 200, confirmed.text
    codes = confirmed.json()["recovery_codes"]
    legacy = legacy_account(owner, user)
    assert authenticate(client, *user[:2]).status_code == 401
    assert stored(owner, user) == legacy and rehash_count(owner, user) == 0
    clock[0] += 30
    accepted = client.post(
        "/api/v1/auth/login", json={**credentials, "mfa_code": totp_code(seed, clock[0])}
    )
    assert accepted.status_code == 200, accepted.text
    assert stored(owner, user).startswith("$argon2id$")
    assert rehash_count(owner, user) == 1
    recovered = client.post("/api/v1/auth/login", json={**credentials, "mfa_code": codes[0]})
    assert recovered.status_code == 200, recovered.text


def test_audit_failure_rolls_back_upgrade_and_session(protected):
    client, owner, _, users = protected
    user = users[1]
    legacy = legacy_account(owner, user)
    with owner.begin() as conn:
        conn.execute(
            text("""CREATE FUNCTION public.reject_test_rehash() RETURNS trigger
            LANGUAGE plpgsql AS $$ BEGIN
              IF NEW.action='auth.password_rehashed' THEN
                RAISE EXCEPTION 'synthetic rehash audit failure'; END IF;
              RETURN NEW; END $$;
            CREATE TRIGGER reject_test_rehash BEFORE INSERT ON security_audit_events
              FOR EACH ROW EXECUTE FUNCTION public.reject_test_rehash();""")
        )
    try:
        response = authenticate(client, *user[:2])
        assert response.status_code == 500
        assert "token" not in response.json()
        assert stored(owner, user) == legacy and rehash_count(owner, user) == 0
        with owner.connect() as conn:
            assert (
                conn.execute(
                    text("SELECT count(*) FROM auth_sessions WHERE user_id=:id"), {"id": user[0]}
                ).scalar_one()
                == 0
            )
    finally:
        with owner.begin() as conn:
            conn.execute(text("DROP TRIGGER reject_test_rehash ON security_audit_events"))
            conn.execute(text("DROP FUNCTION public.reject_test_rehash()"))


def test_current_password_hash_update_function_denies_stale_verifier(protected):
    from uuid import uuid4

    from app.core.identity import hash_password, hash_session_token

    client, owner, _, users = protected
    user = users[1]
    token = authenticate(client, *user[:2]).json()["token"]
    legacy_account(owner, user)
    with owner.begin() as conn:
        conn.execute(text("SET LOCAL ROLE bodyvision_auth_app"))
        result = conn.execute(
            text(
                "SELECT upgrade_private_password_verifier("
                "CAST(:digest AS char(64)),:old,:new,:event,:correlation)"
            ),
            {
                "digest": hash_session_token(token),
                "old": "stale",
                "new": hash_password(PASSWORD),
                "event": uuid4(),
                "correlation": uuid4(),
            },
        ).scalar_one()
        assert result is False
    assert stored(owner, user).startswith("pbkdf2_sha256$")
    assert rehash_count(owner, user) == 0


def test_legacy_enrollment_upgrades_only_after_factor_confirmation(protected, monkeypatch):
    client, owner, _, users = protected
    clock = _enable_mfa(client, monkeypatch)
    user = users[3]
    credentials = _credentials(user)
    legacy = legacy_account(owner, user)
    started = client.post("/api/v1/auth/mfa/enrollment", json=credentials)
    assert started.status_code == 200, started.text
    assert stored(owner, user) == legacy
    assert rehash_count(owner, user) == 0
    seed = parse_qs(urlparse(started.json()["otpauth_uri"]).query)["secret"][0]
    accepted = client.post(
        "/api/v1/auth/mfa/confirm", json={**credentials, "code": totp_code(seed, clock[0])}
    )
    assert accepted.status_code == 200, accepted.text
    assert stored(owner, user).startswith("$argon2id$")
    assert rehash_count(owner, user) == 1


def test_data_role_cannot_upgrade_passwords_even_with_a_valid_session(protected):
    from uuid import uuid4

    from sqlalchemy.exc import DBAPIError

    from app.core.identity import hash_session_token

    client, owner, _, users = protected
    token = authenticate(client, *users[1][:2]).json()["token"]
    with pytest.raises(DBAPIError) as failure, owner.begin() as conn:
        conn.execute(text("SET LOCAL ROLE bodyvision_app"))
        conn.execute(
            text(
                "SELECT upgrade_private_password_verifier("
                "CAST(:digest AS char(64)),:old,:new,:event,:correlation)"
            ),
            {
                "digest": hash_session_token(token),
                "old": "old",
                "new": "new",
                "event": uuid4(),
                "correlation": uuid4(),
            },
        )
    assert failure.value.orig.sqlstate == "42501"
