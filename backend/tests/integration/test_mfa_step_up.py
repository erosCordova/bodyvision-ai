"""MFA privileged access tested against disposable PostgreSQL, never a production DB."""

from urllib.parse import parse_qs, urlparse

from pydantic import SecretStr
from sqlalchemy import text
from test_authenticated_api import PASSWORD, authenticate, headers
from test_authenticated_api import protected as protected

from app.core.mfa import generate_mfa_encryption_key, totp_code
from app.services import mfa_service


def _credentials(user):
    identifier, organization = user[:2]
    return {
        "organization_id": str(organization),
        "email": f"fictional-{identifier.hex[:12]}@example.invalid",
        "password": PASSWORD,
    }


def _enable_mfa(client, monkeypatch):
    settings = client.app.state.settings
    client.app.state.settings = settings.model_copy(
        update={
            "mfa_enabled": True,
            "mfa_encryption_key": SecretStr(generate_mfa_encryption_key()),
        }
    )
    clock = [1_800_000_000]
    monkeypatch.setattr(mfa_service, "_totp_now", lambda: clock[0])
    return clock


def test_privileged_step_up_enrollment_replay_and_recovery_are_atomic(protected, monkeypatch):
    client, owner, _, users = protected
    specialist, member, _, administrator = users
    old = authenticate(client, *administrator[:2]).json()["token"]
    clock = _enable_mfa(client, monkeypatch)

    assert client.get("/api/v1/auth/me", headers=headers(old)).status_code == 401
    assert authenticate(client, *member[:2]).status_code == 200
    for user in (specialist, administrator):
        denied = authenticate(client, *user[:2])
        assert denied.status_code == 428
        assert denied.json()["code"] == "MFA_SETUP_REQUIRED"

    user = administrator
    credentials = _credentials(user)
    started = client.post("/api/v1/auth/mfa/enrollment", json=credentials)
    assert started.status_code == 200, started.text
    uri = started.json()["otpauth_uri"]
    seed = parse_qs(urlparse(uri).query)["secret"][0]
    assert uri.startswith("otpauth://totp/")

    wrong = client.post("/api/v1/auth/mfa/confirm", json={**credentials, "code": "12345x"})
    assert wrong.status_code == 401
    with owner.connect() as db:
        stored = (
            db.execute(
                text(
                    "SELECT encrypted_totp_seed,confirmed_at FROM private_mfa_credentials "
                    "WHERE user_id=:user"
                ),
                {"user": user[0]},
            )
            .mappings()
            .one()
        )
        assert seed not in stored["encrypted_totp_seed"]
        assert stored["confirmed_at"] is None

    confirmed = client.post(
        "/api/v1/auth/mfa/confirm",
        json={**credentials, "code": totp_code(seed, clock[0])},
    )
    assert confirmed.status_code == 200, confirmed.text
    payload = confirmed.json()
    assert payload["role"] == "administrator"
    assert len(payload["recovery_codes"]) == len(set(payload["recovery_codes"])) == 8
    assert client.get("/api/v1/auth/me", headers=headers(payload["token"])).status_code == 200
    assert client.get("/api/v1/auth/me", headers=headers(old)).status_code == 401
    with owner.connect() as db:
        stored = (
            db.execute(
                text(
                    "SELECT last_accepted_step,confirmed_at FROM private_mfa_credentials "
                    "WHERE user_id=:user"
                ),
                {"user": user[0]},
            )
            .mappings()
            .one()
        )
        assert stored["confirmed_at"] is not None
        assert stored["last_accepted_step"] == clock[0] // 30
        rows = (
            db.execute(
                text("SELECT code_verifier FROM private_mfa_recovery_codes WHERE user_id=:user"),
                {"user": user[0]},
            )
            .scalars()
            .all()
        )
        assert len(rows) == 8
        assert not any(code in "".join(rows) for code in payload["recovery_codes"])

    assert client.post("/api/v1/auth/mfa/enrollment", json=credentials).status_code == 409
    without_code = authenticate(client, *user[:2])
    assert without_code.status_code == 401
    assert without_code.json()["code"] == "MFA_CODE_REQUIRED"
    reused = client.post(
        "/api/v1/auth/login",
        json={**credentials, "mfa_code": totp_code(seed, clock[0])},
    )
    assert reused.status_code == 401
    assert reused.json()["code"] == "MFA_CODE_INVALID"

    clock[0] += 30
    next_code = client.post(
        "/api/v1/auth/login",
        json={**credentials, "mfa_code": totp_code(seed, clock[0])},
    )
    assert next_code.status_code == 200, next_code.text
    assert next_code.json()["role"] == "administrator"
    with owner.connect() as db:
        verified = db.execute(
            text(
                "SELECT mfa_verified_at FROM auth_sessions WHERE token_sha256="
                "encode(sha256(convert_to(:token,'UTF8')),'hex')"
            ),
            {"token": next_code.json()["token"]},
        ).scalar_one()
        assert verified is not None

    recovery = payload["recovery_codes"][0]
    recovered = client.post("/api/v1/auth/login", json={**credentials, "mfa_code": recovery})
    assert recovered.status_code == 200, recovered.text
    again = client.post("/api/v1/auth/login", json={**credentials, "mfa_code": recovery})
    assert again.status_code == 401
    assert again.json()["code"] == "MFA_CODE_INVALID"
    assert (
        client.get("/api/v1/auth/me", headers=headers(recovered.json()["token"])).status_code == 200
    )


def test_enrollment_is_opt_in_and_cannot_use_wrong_password(protected, monkeypatch):
    client, _, _, users = protected
    credentials = _credentials(users[0])
    assert client.post("/api/v1/auth/mfa/enrollment", json=credentials).status_code == 404
    assert (
        client.post("/api/v1/auth/mfa/confirm", json={**credentials, "code": "123456"}).status_code
        == 404
    )
    _enable_mfa(client, monkeypatch)
    wrong = client.post(
        "/api/v1/auth/mfa/enrollment",
        json={**credentials, "password": "not the right secret"},
    )
    assert wrong.status_code == 401
    assert "otpauth_uri" not in wrong.text
    assert (
        client.post("/api/v1/auth/mfa/confirm", json={**credentials, "code": "123456"}).status_code
        == 401
    )


def test_two_factor_challenges_are_tenant_and_account_scoped(protected, monkeypatch):
    client, _, _, users = protected
    _enable_mfa(client, monkeypatch)
    first = _credentials(users[0])
    foreign = _credentials(users[2])
    started = client.post("/api/v1/auth/mfa/enrollment", json=first)
    assert started.status_code == 200
    stolen_uri = started.json()["otpauth_uri"]
    assert (
        client.post(
            "/api/v1/auth/mfa/confirm",
            json={
                **foreign,
                "code": totp_code(parse_qs(urlparse(stolen_uri).query)["secret"][0], 1_800_000_000),
            },
        ).status_code
        == 401
    )
    assert authenticate(client, *users[0][:2]).status_code == 428
    assert authenticate(client, *users[2][:2]).status_code == 428


def test_recovery_replaces_factor_and_revokes_sessions_and_prior_codes(protected, monkeypatch):
    client, owner, _, users = protected
    clock = _enable_mfa(client, monkeypatch)
    user = users[0]
    credentials = _credentials(user)

    first = client.post("/api/v1/auth/mfa/enrollment", json=credentials)
    assert first.status_code == 200, first.text
    first_seed = parse_qs(urlparse(first.json()["otpauth_uri"]).query)["secret"][0]
    enrolled = client.post(
        "/api/v1/auth/mfa/confirm",
        json={**credentials, "code": totp_code(first_seed, clock[0])},
    )
    assert enrolled.status_code == 200, enrolled.text
    old_token = enrolled.json()["token"]
    old_codes = enrolled.json()["recovery_codes"]
    assert client.get("/api/v1/auth/me", headers=headers(old_token)).status_code == 200

    incorrect = client.post(
        "/api/v1/auth/mfa/recover",
        json={**credentials, "recovery_code": "F" * 32},
    )
    assert incorrect.status_code == 401
    assert client.get("/api/v1/auth/me", headers=headers(old_token)).status_code == 200

    replacement = client.post(
        "/api/v1/auth/mfa/recover",
        json={**credentials, "recovery_code": old_codes[0]},
    )
    assert replacement.status_code == 200, replacement.text
    new_seed = parse_qs(urlparse(replacement.json()["otpauth_uri"]).query)["secret"][0]
    assert new_seed != first_seed
    assert client.get("/api/v1/auth/me", headers=headers(old_token)).status_code == 401

    with owner.connect() as connection:
        confirmed_at = connection.execute(
            text("SELECT confirmed_at FROM private_mfa_credentials WHERE user_id=:actor"),
            {"actor": user[0]},
        ).scalar_one()
        remaining_codes = connection.execute(
            text("SELECT count(*) FROM private_mfa_recovery_codes WHERE user_id=:actor"),
            {"actor": user[0]},
        ).scalar_one()
        old_active_sessions = connection.execute(
            text("""
                SELECT count(*) FROM auth_sessions
                WHERE user_id=:actor AND revoked_at IS NULL
            """),
            {"actor": user[0]},
        ).scalar_one()
    assert confirmed_at is None
    assert remaining_codes == 0
    assert old_active_sessions == 0
    assert authenticate(client, *user[:2]).status_code == 428

    stale_recovery = client.post(
        "/api/v1/auth/mfa/recover",
        json={**credentials, "recovery_code": old_codes[0]},
    )
    assert stale_recovery.status_code == 401

    rotated = client.post(
        "/api/v1/auth/mfa/confirm",
        json={**credentials, "code": totp_code(new_seed, clock[0])},
    )
    assert rotated.status_code == 200, rotated.text
    new_codes = rotated.json()["recovery_codes"]
    assert len(new_codes) == 8
    assert set(new_codes).isdisjoint(set(old_codes))
    assert client.get(
        "/api/v1/auth/me", headers=headers(rotated.json()["token"])
    ).status_code == 200

    # A previously valid code, not just the consumed code, must be invalidated.
    rejected = client.post(
        "/api/v1/auth/login",
        json={**credentials, "mfa_code": old_codes[1]},
    )
    assert rejected.status_code == 401
    clock[0] += 30
    accepted = client.post(
        "/api/v1/auth/login",
        json={**credentials, "mfa_code": totp_code(new_seed, clock[0])},
    )
    assert accepted.status_code == 200


def test_recovery_does_not_disclose_a_factor_to_wrong_password(protected, monkeypatch):
    client, _, _, users = protected
    _enable_mfa(client, monkeypatch)
    credentials = _credentials(users[0])
    result = client.post(
        "/api/v1/auth/mfa/recover",
        json={**credentials, "password": "wrong", "recovery_code": "F" * 32},
    )
    assert result.status_code == 401
    assert "otpauth_uri" not in result.text
