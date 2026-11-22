"""Owner-only MFA recovery on disposable local PostgreSQL, never hosted data."""

from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.engine import make_url
from test_authenticated_api import authenticate, headers
from test_authenticated_api import protected as protected
from test_mfa_step_up import _credentials, _enable_mfa

from app.core.mfa import totp_code
from app.maintenance.recover_synthetic_mfa import RecoveryDenied, recover_synthetic_mfa

ENV = {
    "APP_ENV": "test",
    "IDENTITY_ENABLED": "true",
    "MFA_ENABLED": "true",
    "BODYVISION_ENABLE_MFA_ASSISTED_RECOVERY": "synthetic-only",
}


@pytest.fixture
def lost_factor(protected, monkeypatch, request):
    client, owner, profile, users = protected
    if make_url(owner.url).host not in {"localhost", "127.0.0.1", "::1"}:
        pytest.skip("Positive owner recovery requires disposable loopback PostgreSQL")
    clock = _enable_mfa(client, monkeypatch)
    index = getattr(request, "param", 0)
    users = [users[index], *[user for position, user in enumerate(users) if position != index]]
    user = users[0]
    credentials = _credentials(user)
    started = client.post("/api/v1/auth/mfa/enrollment", json=credentials)
    assert started.status_code == 200, started.text
    seed = parse_qs(urlparse(started.json()["otpauth_uri"]).query)["secret"][0]
    confirmed = client.post(
        "/api/v1/auth/mfa/confirm", json={**credentials, "code": totp_code(seed, clock[0])}
    )
    assert confirmed.status_code == 200, confirmed.text
    old = confirmed.json()
    # Simulate the documented offline boundary: close both runtime pools.
    client.app.state.engine.dispose()
    client.app.state.auth_engine.dispose()
    yield client, owner, profile, users, clock, credentials, seed, old


def reset(connection, user, *, review=None, confirmed=None):
    return recover_synthetic_mfa(
        connection,
        user[1],
        user[0],
        review or uuid4(),
        confirmed_user_id=confirmed or user[0],
        environment=ENV,
    )


@pytest.mark.parametrize("lost_factor", [0, 3], indirect=True)
def test_lost_codes_recovery_requires_password_and_new_factor_then_rejects_old_codes(lost_factor):
    client, owner, _, users, clock, credentials, old_seed, old = lost_factor
    user = users[0]
    review = uuid4()
    with owner.begin() as conn:
        original = conn.execute(
            text("SELECT password_hash FROM users WHERE id=:user"), {"user": user[0]}
        ).scalar_one()
        grant_query = text(
            "SELECT profile_id,access_level FROM profile_access "
            "WHERE user_id=:user ORDER BY profile_id"
        )
        before_grants = conn.execute(grant_query, {"user": user[0]}).all()
        assert reset(conn, user, review=review) == 1
        assert (
            conn.execute(
                text("SELECT password_hash FROM users WHERE id=:user"), {"user": user[0]}
            ).scalar_one()
            == original
        )
        for table in ("private_mfa_credentials", "private_mfa_recovery_codes"):
            assert (
                conn.execute(
                    text(f"SELECT count(*) FROM {table} WHERE user_id=:user"), {"user": user[0]}
                ).scalar_one()
                == 0
            )
        audit = (
            conn.execute(text("SELECT * FROM security_audit_events WHERE id=:id"), {"id": review})
            .mappings()
            .one()
        )
        assert audit["actor_id"] is None
        assert audit["action"] == "mfa.recovery_synthetic_offline"
        assert audit["resource_id"] == user[0] and audit["chain_sequence"] > 0
        assert conn.execute(grant_query, {"user": user[0]}).all() == before_grants
    assert client.get("/api/v1/auth/me", headers=headers(old["token"])).status_code == 401
    assert authenticate(client, *user[:2]).status_code == 428
    wrong = client.post(
        "/api/v1/auth/mfa/enrollment", json={**credentials, "password": "not the current password"}
    )
    assert wrong.status_code == 401 and "otpauth_uri" not in wrong.text
    started = client.post("/api/v1/auth/mfa/enrollment", json=credentials)
    assert started.status_code == 200, started.text
    new_seed = parse_qs(urlparse(started.json()["otpauth_uri"]).query)["secret"][0]
    assert new_seed != old_seed
    assert authenticate(client, *user[:2]).status_code == 428
    enrolled = client.post(
        "/api/v1/auth/mfa/confirm", json={**credentials, "code": totp_code(new_seed, clock[0])}
    )
    assert enrolled.status_code == 200, enrolled.text
    assert enrolled.json()["role"] == user[2]
    assert len(enrolled.json()["recovery_codes"]) == 8
    assert set(enrolled.json()["recovery_codes"]).isdisjoint(old["recovery_codes"])
    assert (
        client.get("/api/v1/auth/me", headers=headers(enrolled.json()["token"])).status_code == 200
    )
    rejected = client.post(
        "/api/v1/auth/login", json={**credentials, "mfa_code": old["recovery_codes"][0]}
    )
    assert rejected.status_code == 401
    client.app.state.auth_engine.dispose()
    client.app.state.engine.dispose()
    with owner.begin() as conn:
        with pytest.raises(RecoveryDenied, match="ya se utilizó"):
            reset(conn, user, review=review)
        assert (
            conn.execute(
                text("SELECT confirmed_at FROM private_mfa_credentials WHERE user_id=:id"),
                {"id": user[0]},
            ).scalar_one()
            is not None
        )


def test_recovery_rolls_back_factor_codes_and_sessions_when_audit_fails(lost_factor):
    client, owner, _, users, _, _, _, old = lost_factor

    def fail_audit(conn, cursor, statement, parameters, context, executemany):
        if "mfa.recovery_synthetic_offline" in statement:
            raise RuntimeError("Synthetic audit failure")

    event.listen(owner, "before_cursor_execute", fail_audit)
    try:
        with owner.begin() as conn:
            with pytest.raises(RuntimeError, match="Synthetic audit"):
                reset(conn, users[0])
            # Savepoint rollback holds even if the outer transaction continues.
            assert (
                conn.execute(
                    text("SELECT count(*) FROM private_mfa_credentials WHERE user_id=:id"),
                    {"id": users[0][0]},
                ).scalar_one()
                == 1
            )
            assert (
                conn.execute(
                    text("SELECT count(*) FROM private_mfa_recovery_codes WHERE user_id=:id"),
                    {"id": users[0][0]},
                ).scalar_one()
                == 8
            )
    finally:
        event.remove(owner, "before_cursor_execute", fail_audit)
    assert client.get("/api/v1/auth/me", headers=headers(old["token"])).status_code == 200


def test_recovery_denies_runtime_roles_connections_and_wrong_confirmation(lost_factor):
    client, owner, _, users, _, _, _, _ = lost_factor
    for role in ("bodyvision_app", "bodyvision_auth_app"):
        with owner.begin() as conn:
            conn.execute(text(f"SET LOCAL ROLE {role}"))
            with pytest.raises(RecoveryDenied, match="migrador"):
                reset(conn, users[0])
    with owner.begin() as conn:
        with pytest.raises(RecoveryDenied, match="confirmación"):
            reset(conn, users[0], confirmed=uuid4())
    with client.app.state.auth_engine.connect():
        with owner.begin() as conn:
            with pytest.raises(RecoveryDenied, match="conexiones"):
                reset(conn, users[0])
    client.app.state.auth_engine.dispose()
    with owner.connect() as conn:
        with pytest.raises(RecoveryDenied, match="transacción"):
            reset(conn, users[0])


@pytest.mark.parametrize(
    "restriction", ["disabled", "real-email", "wrong-org", "member", "no-factor"]
)
def test_recovery_rejects_ineligible_targets_without_changes(lost_factor, restriction):
    _, owner, _, users, _, _, _, _ = lost_factor
    user = users[0]
    with owner.begin() as conn:
        if restriction == "disabled":
            conn.execute(
                text("UPDATE users SET account_status='disabled' WHERE id=:id"), {"id": user[0]}
            )
        elif restriction == "real-email":
            conn.execute(
                text("UPDATE users SET email='excluded@example.com' WHERE id=:id"), {"id": user[0]}
            )
        elif restriction == "member":
            conn.execute(
                text("UPDATE user_role_assignments SET role='member' WHERE user_id=:id"),
                {"id": user[0]},
            )
        elif restriction == "no-factor":
            conn.execute(
                text("DELETE FROM private_mfa_credentials WHERE user_id=:id"), {"id": user[0]}
            )
        review = uuid4()
        with pytest.raises(RecoveryDenied):
            target = (user[0], users[2][1]) if restriction == "wrong-org" else user
            reset(conn, target, review=review)
        assert (
            conn.execute(
                text("SELECT count(*) FROM security_audit_events WHERE id=:id"), {"id": review}
            ).scalar_one()
            == 0
        )
        assert conn.execute(
            text("SELECT count(*) FROM private_mfa_credentials WHERE user_id=:id"),
            {"id": user[0]},
        ).scalar_one() == (0 if restriction == "no-factor" else 1)
        assert (
            conn.execute(
                text("SELECT count(*) FROM auth_sessions WHERE user_id=:id AND revoked_at IS NULL"),
                {"id": user[0]},
            ).scalar_one()
            == 1
        )
