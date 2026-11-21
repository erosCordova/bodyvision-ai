"""Opt-in disposable recovery drill. Never run against a hosted database.

Prepare private synthetic state before pg_dump; verify the restored application
after exact data comparison. Keys/passwords stay in a private runner bind mount,
outside the backup. API requests use genuine LOGIN roles, never SET ROLE.
"""

import argparse
import json
import logging
import os
import secrets
import stat
import struct
import time
import zlib
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from uuid import NAMESPACE_URL, uuid4, uuid5

import uvicorn
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from psycopg import sql
from pydantic import ValidationError
from sqlalchemy import URL, create_engine, text
from sqlalchemy.exc import DBAPIError

from app.core.config import Settings
from app.core.identity import hash_password
from app.core.mfa import totp_code
from app.main import create_app
from app.models.context import FIRST_WORKSPACE, SECOND_WORKSPACE

STATE = Path("/recovery-state/state.json")


class RecoveryRejected(ValueError):
    pass


def require(condition, code):
    if not condition:
        raise RecoveryRejected(code)


def guard(environment):
    require(
        environment.get("APP_ENV") == "test"
        and environment.get("CI") == "true"
        and environment.get("BODYVISION_RESTORE_DRILL") == "synthetic-only"
        and environment.get("POSTGRES_DB") == "bodyvision"
        and environment.get("POSTGRES_USER") == "postgres"
        and bool(environment.get("POSTGRES_PASSWORD"))
        and bool(environment.get("POSTGRES_APP_PASSWORD")),
        "explicit_disposable_ci_required",
    )


def database_url(database, role, password):
    require(database in {"bodyvision", "bodyvision_recovered_ci"}, "invalid_database")
    require(role in {"postgres", "bodyvision_app", "bodyvision_auth_app"}, "invalid_role")
    return URL.create(
        "postgresql+psycopg",
        username=role,
        password=password,
        host="127.0.0.1",
        port=5432,
        database=database,
    ).render_as_string(hide_password=False)


def engine(url):
    return create_engine(url, hide_parameters=True, connect_args={"connect_timeout": 3})


def configure_login(connection, role, password):
    require(role in {"bodyvision_app", "bodyvision_auth_app"}, "invalid_role")
    with connection.connection.driver_connection.cursor() as cursor:
        cursor.execute(
            sql.SQL(
                "ALTER ROLE {} LOGIN PASSWORD {} NOSUPERUSER NOCREATEDB "
                "NOCREATEROLE NOINHERIT NOBYPASSRLS"
            ).format(sql.Identifier(role), sql.Literal(password))
        )


def settings(database, state, key, *, mfa=False):
    return Settings(
        app_env="test",
        identity_enabled=True,
        database_url=database_url(database, "bodyvision_app", os.environ["POSTGRES_APP_PASSWORD"]),
        auth_database_url=database_url(database, "bodyvision_auth_app", state["auth_password"]),
        capture_encryption_key=key,
        capture_retention_enabled=False,
        mfa_enabled=mfa,
        mfa_encryption_key=state.get("mfa_key") if mfa else None,
    )


def recovery_client(config):
    # The inherited Docker ALLOWED_HOSTS deliberately excludes "testserver".
    return TestClient(create_app(config), base_url="http://127.0.0.1")


def png():
    def chunk(kind, data):
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    pixels = bytes([0] + [100, 120, 140] * 32) * 64
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 32, 64, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(pixels))
        + chunk(b"IEND", b"")
    )


def login(client, state, outsider=False):
    response = client.post(
        "/api/v1/auth/login",
        json={
            "organization_id": str(SECOND_WORKSPACE if outsider else FIRST_WORKSPACE),
            "email": "recovery.outsider@example.invalid"
            if outsider
            else "recovery.admin@example.invalid",
            "password": state["account_password"],
        },
    )
    require(response.status_code == 200, f"private_login_failed_{response.status_code}")
    return {"Authorization": "Bearer " + response.json()["token"]}


def mfa_credentials(state):
    return {
        "organization_id": str(FIRST_WORKSPACE),
        "email": "recovery.mfa@example.invalid",
        "password": state["account_password"],
    }


def rejected_mfa(response, status, code):
    payload = response.json()
    require(
        response.status_code == status
        and payload.get("code") == code
        and "token" not in payload
        and "recovery_codes" not in payload,
        "mfa_negative_check_failed",
    )


def prepare_mfa(state):
    credentials = mfa_credentials(state)
    with recovery_client(settings("bodyvision", state, state["capture_key"], mfa=True)) as client:
        rejected_mfa(client.post("/api/v1/auth/login", json=credentials), 428, "MFA_SETUP_REQUIRED")
        started = client.post("/api/v1/auth/mfa/enrollment", json=credentials)
        require(started.status_code == 200, "mfa_enrollment_failed")
        seed = parse_qs(urlparse(started.json()["otpauth_uri"]).query)["secret"][0]
        accepted_at = int(time.time())
        confirmed = client.post(
            "/api/v1/auth/mfa/confirm",
            json={
                **credentials,
                "code": totp_code(seed, accepted_at),
            },
        )
        require(confirmed.status_code == 200, "mfa_confirmation_failed")
        codes = confirmed.json()["recovery_codes"]
        require(len(codes) == len(set(codes)) == 8, "mfa_recovery_inventory_failed")
        used = client.post("/api/v1/auth/login", json={**credentials, "mfa_code": codes[0]})
        require(used.status_code == 200, "mfa_source_recovery_failed")
        state.update(
            {
                "mfa_seed": seed,
                "mfa_enrolled_step": accepted_at // 30,
                "mfa_used_code": codes[0],
                "mfa_unused_code": codes[1],
                "mfa_reset_code": codes[2],
                "mfa_old_unused_code": codes[3],
                "mfa_session": "Bearer " + used.json()["token"],
            }
        )


def verify_mfa(state):
    config = settings("bodyvision_recovered_ci", state, state["capture_key"], mfa=True)
    credentials = mfa_credentials(state)
    path = f"/api/v1/profiles/{state['profile']}"
    for url in (
        config.database_url.get_secret_value(),
        config.auth_database_url.get_secret_value(),
    ):
        denied_query(url, "SELECT encrypted_totp_seed FROM private_mfa_credentials")
        denied_query(url, "SELECT code_verifier FROM private_mfa_recovery_codes")
    missing = {key: value for key, value in state.items() if key != "mfa_key"}
    try:
        settings("bodyvision_recovered_ci", missing, state["capture_key"], mfa=True)
    except ValidationError:
        pass
    else:
        raise RecoveryRejected("mfa_missing_key_allowed_startup")
    wrong = {**state, "mfa_key": Fernet.generate_key().decode("ascii")}
    with recovery_client(
        settings("bodyvision_recovered_ci", wrong, state["capture_key"], mfa=True)
    ) as blocked:
        response = blocked.post(
            "/api/v1/auth/login",
            json={
                **credentials,
                "mfa_code": totp_code(state["mfa_seed"], int(time.time())),
            },
        )
        rejected_mfa(response, 500, "INTERNAL_ERROR")
    with recovery_client(config) as client:
        previous = {"Authorization": state["mfa_session"]}
        require(
            client.get(path, headers=previous).status_code == 200, "mfa_restored_session_failed"
        )
        rejected_mfa(client.post("/api/v1/auth/login", json=credentials), 401, "MFA_CODE_REQUIRED")
        rejected_mfa(
            client.post(
                "/api/v1/auth/login",
                json={
                    **credentials,
                    "mfa_code": state["mfa_used_code"],
                },
            ),
            401,
            "MFA_CODE_INVALID",
        )
        # Use the next unconsumed step if restore completes within 30 seconds.
        # This is inside the existing +1 drift window; no clock is mocked.
        next_step = max(int(time.time()) // 30, state["mfa_enrolled_step"] + 1)
        code = totp_code(state["mfa_seed"], next_step * 30)
        signed_in = client.post("/api/v1/auth/login", json={**credentials, "mfa_code": code})
        require(signed_in.status_code == 200, "mfa_restored_totp_failed")
        signed_headers = {"Authorization": "Bearer " + signed_in.json()["token"]}
        require(
            client.get(path, headers=signed_headers).status_code == 200, "mfa_fresh_session_failed"
        )
        rejected_mfa(
            client.post("/api/v1/auth/login", json={**credentials, "mfa_code": code}),
            401,
            "MFA_CODE_INVALID",
        )
        recovered = client.post(
            "/api/v1/auth/login",
            json={
                **credentials,
                "mfa_code": state["mfa_unused_code"],
            },
        )
        require(recovered.status_code == 200, "mfa_restored_recovery_failed")
        recovered_headers = {"Authorization": "Bearer " + recovered.json()["token"]}
        require(
            client.get(path, headers=recovered_headers).status_code == 200,
            "mfa_recovery_session_failed",
        )
        rejected_mfa(
            client.post(
                "/api/v1/auth/login",
                json={
                    **credentials,
                    "mfa_code": state["mfa_unused_code"],
                },
            ),
            401,
            "MFA_CODE_INVALID",
        )
        replacement = client.post(
            "/api/v1/auth/mfa/recover",
            json={
                **credentials,
                "recovery_code": state["mfa_reset_code"],
            },
        )
        require(replacement.status_code == 200, "mfa_restored_factor_reset_failed")
        seed = parse_qs(urlparse(replacement.json()["otpauth_uri"]).query)["secret"][0]
        require(seed != state["mfa_seed"], "mfa_replacement_seed_unchanged")
        for headers in (previous, signed_headers, recovered_headers):
            require(
                client.get(path, headers=headers).status_code == 401,
                "mfa_prior_session_not_revoked",
            )
        rejected_mfa(client.post("/api/v1/auth/login", json=credentials), 428, "MFA_SETUP_REQUIRED")
        confirmed = client.post(
            "/api/v1/auth/mfa/confirm",
            json={
                **credentials,
                "code": totp_code(seed, int(time.time())),
            },
        )
        require(confirmed.status_code == 200, "mfa_replacement_confirmation_failed")
        new_codes = confirmed.json()["recovery_codes"]
        require(len(new_codes) == len(set(new_codes)) == 8, "mfa_replacement_codes_failed")
        rejected_mfa(
            client.post(
                "/api/v1/auth/login",
                json={
                    **credentials,
                    "mfa_code": state["mfa_old_unused_code"],
                },
            ),
            401,
            "MFA_CODE_INVALID",
        )
        new_headers = {"Authorization": "Bearer " + confirmed.json()["token"]}
        require(
            client.get(path, headers=new_headers).status_code == 200,
            "mfa_replacement_session_failed",
        )
        audit = client.post("/api/v1/auth/audit/verify", headers=new_headers)
        require(
            audit.status_code == 200
            and audit.json()["valid"]
            and audit.json()["checked_events"] > 0,
            "mfa_restored_audit_failed",
        )
        state.update(
            {
                "browser_code": new_codes[0],
                "browser_second_code": new_codes[1],
            }
        )


def prepare():
    require(not STATE.exists(), "state_already_exists")
    state = {
        "auth_password": secrets.token_urlsafe(32),
        "account_password": secrets.token_urlsafe(32),
        "capture_key": Fernet.generate_key().decode("ascii"),
        "mfa_key": Fernet.generate_key().decode("ascii"),
        "profile": str(uuid5(NAMESPACE_URL, f"bodyvision:fixture:{FIRST_WORKSPACE}:1")),
    }
    owner = engine(database_url("bodyvision", "postgres", os.environ["POSTGRES_PASSWORD"]))
    try:
        with owner.begin() as conn:
            configure_login(conn, "bodyvision_auth_app", state["auth_password"])
            for org, role, email in (
                (FIRST_WORKSPACE, "administrator", "recovery.admin@example.invalid"),
                (SECOND_WORKSPACE, "member", "recovery.outsider@example.invalid"),
                (FIRST_WORKSPACE, "administrator", "recovery.mfa@example.invalid"),
            ):
                identifier = uuid4()
                conn.execute(
                    text("""INSERT INTO users
                    (id,organization_id,display_name,email,password_hash,is_local_operator,account_status)
                    VALUES (:id,:org,'Recuperación ficticia',:email,:hash,false,'active')"""),
                    {
                        "id": identifier,
                        "org": org,
                        "email": email,
                        "hash": hash_password(state["account_password"]),
                    },
                )
                conn.execute(
                    text("""INSERT INTO user_role_assignments(id,organization_id,user_id,role)
                    VALUES (:id,:org,:user,:role)"""),
                    {"id": uuid4(), "org": org, "user": identifier, "role": role},
                )
                if role == "administrator":
                    if email == "recovery.admin@example.invalid":
                        state["actor"] = str(identifier)
                    conn.execute(
                        text("""INSERT INTO profile_access
                        (id,organization_id,profile_id,user_id,access_level)
                        VALUES (:id,:org,:profile,:user,'manage')"""),
                        {
                            "id": uuid4(),
                            "org": org,
                            "profile": state["profile"],
                            "user": identifier,
                        },
                    )
        with recovery_client(settings("bodyvision", state, state["capture_key"])) as client:
            headers = login(client, state)
            state["restored_session"] = headers["Authorization"]
            for purpose in ("capture", "storage"):
                response = client.post(
                    f"/api/v1/auth/profiles/{state['profile']}/consents",
                    headers=headers,
                    json={"purpose": purpose, "version": "bv-synthetic-v1", "confirmed": True},
                )
                require(response.status_code == 200, "consent_setup_failed")
            response = client.post(
                f"/api/v1/profiles/{state['profile']}/captures",
                content=png(),
                headers={**headers, "Content-Type": "image/png", "X-Synthetic-Only": "confirmed"},
            )
            require(response.status_code == 201, "encrypted_fixture_failed")
            state["capture"] = response.json()["id"]
        prepare_mfa(state)
        descriptor = os.open(STATE, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "w") as target:
            json.dump(state, target)
    finally:
        owner.dispose()


def denied_query(url, statement):
    probe = engine(url)
    try:
        try:
            with probe.connect() as conn:
                conn.execute(text(statement)).all()
        except DBAPIError as exc:
            require(getattr(exc.orig, "sqlstate", None) == "42501", "unexpected_privilege_failure")
        else:
            raise RecoveryRejected("excessive_privileges")
    finally:
        probe.dispose()


def read_state():
    info = STATE.lstat()
    require(
        stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077 and 0 < info.st_size < 16384,
        "unsafe_state_file",
    )
    return json.loads(STATE.read_text())


def verify():
    state = read_state()
    owner = engine(
        database_url("bodyvision_recovered_ci", "postgres", os.environ["POSTGRES_PASSWORD"])
    )
    try:
        with owner.begin() as conn:
            configure_login(conn, "bodyvision_app", os.environ["POSTGRES_APP_PASSWORD"])
            configure_login(conn, "bodyvision_auth_app", state["auth_password"])
    finally:
        owner.dispose()
    config = settings("bodyvision_recovered_ci", state, state["capture_key"])
    app_url = config.database_url.get_secret_value()
    auth_url = config.auth_database_url.get_secret_value()
    for url, expected in ((app_url, "bodyvision_app"), (auth_url, "bodyvision_auth_app")):
        probe = engine(url)
        try:
            with probe.begin() as conn:
                role = conn.execute(
                    text("""SELECT current_user,session_user,rolsuper,rolbypassrls
                    FROM pg_roles WHERE rolname=current_user""")
                ).one()
                require(tuple(role) == (expected, expected, False, False), "unsafe_runtime_role")
                if expected == "bodyvision_app":
                    require(
                        conn.execute(text("SELECT count(*) FROM profiles")).scalar_one() == 0,
                        "rls_without_context_failed",
                    )
                    conn.execute(
                        text("SELECT set_config('app.organization_id',:org,true)"),
                        {"org": str(FIRST_WORKSPACE)},
                    )
                    conn.execute(
                        text("SELECT set_config('app.actor_id',:actor,true)"),
                        {"actor": state["actor"]},
                    )
                    require(
                        conn.execute(
                            text("SELECT count(*) FROM profiles WHERE organization_id=:org"),
                            {"org": SECOND_WORKSPACE},
                        ).scalar_one()
                        == 0,
                        "rls_cross_organization_failed",
                    )
        finally:
            probe.dispose()
    denied_query(app_url, "SELECT password_hash FROM users")
    denied_query(auth_url, "SELECT ciphertext FROM synthetic_capture_objects")
    incorrect = engine(
        database_url("bodyvision_recovered_ci", "bodyvision_app", secrets.token_urlsafe(32))
    )
    try:
        try:
            with incorrect.connect():
                raise RecoveryRejected("password_authentication_bypassed")
        except DBAPIError as exc:
            require(
                "password authentication failed" in str(exc.orig),
                "wrong_password_check_unverifiable",
            )
    finally:
        incorrect.dispose()
    path = f"/api/v1/profiles/{state['profile']}"
    capture = f"{path}/captures/{state['capture']}"
    with recovery_client(config) as client:
        require(client.get("/api/v1/health/ready").status_code == 200, "restored_readiness_failed")
        require(client.get(path).status_code == 401, "anonymous_access_failed")
        old_headers = {"Authorization": state["restored_session"]}
        require(client.get(path, headers=old_headers).status_code == 200, "restored_session_failed")
        headers = login(client, state)
        outsider = login(client, state, outsider=True)
        require(client.get(path, headers=outsider).status_code == 404, "foreign_profile_access")
        require(client.get(capture, headers=outsider).status_code == 404, "foreign_capture_access")
        downloaded = client.get(capture, headers=headers)
        require(
            downloaded.status_code == 200 and downloaded.content == png(), "restored_key_failed"
        )
        response = client.post(
            path + "/measurements",
            headers={**headers, "Idempotency-Key": str(uuid4())},
            json={
                "metric_code": "weight",
                "value": 70.25,
                "unit": "kg",
                "method": "manual",
                # Before the deliberately atypical 84 kg seed at one hour ago.
                "measured_at": (datetime.now(UTC) - timedelta(hours=2)).isoformat(),
            },
        )
        require(response.status_code == 201, f"restored_write_failed_{response.status_code}")
        identifier = response.json()["id"]
        listing = client.get(path + "/measurements", headers=headers)
        require(
            listing.status_code == 200
            and any(
                row["id"] == identifier and row["value"] == 70.25 and row["unit"] == "kg"
                for row in listing.json()["items"]
            ),
            "restored_read_after_write_failed",
        )
        audit = client.post("/api/v1/auth/audit/verify", headers=headers)
        require(
            audit.status_code == 200
            and audit.json()["valid"]
            and audit.json()["checked_events"] > 0,
            "restored_audit_chain_failed",
        )
        for key, expected in ((None, 503), (Fernet.generate_key().decode("ascii"), 500)):
            with recovery_client(settings("bodyvision_recovered_ci", state, key)) as blocked:
                response = blocked.get(capture, headers=headers)
                require(
                    response.status_code == expected and response.content != png(),
                    "missing_or_wrong_key_released_pixels",
                )
        require(
            client.post("/api/v1/auth/logout", headers=old_headers).status_code == 204,
            "restored_logout_failed",
        )
        require(client.get(path, headers=old_headers).status_code == 401, "revocation_failed")
    verify_mfa(state)
    # Export only to the same private runner file; never to stdout/artifacts.
    descriptor = os.open(STATE, os.O_WRONLY | os.O_TRUNC | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "w") as target:
        json.dump(state, target)
    print('{"event":"synthetic_recovered_mfa_verified"}')


def serve():
    state = read_state()
    config = settings("bodyvision_recovered_ci", state, state["capture_key"], mfa=True)
    uvicorn.run(create_app(config), host="127.0.0.1", port=8000, access_log=False, log_config=None)


def main():
    parser = argparse.ArgumentParser(description="Disposable recovered application acceptance")
    parser.add_argument("operation", choices=["prepare", "verify", "serve"])
    args = parser.parse_args()
    logging.disable(logging.CRITICAL)
    try:
        guard(os.environ)
        if args.operation == "serve":
            serve()
            return 0
        (prepare if args.operation == "prepare" else verify)()
    except RecoveryRejected as exc:
        print(json.dumps({"event": "synthetic_recovered_application_rejected", "check": str(exc)}))
        return 2
    except Exception as exc:
        # Exceptions can contain SQL, account IDs, passwords and connection URLs.
        print(
            json.dumps(
                {
                    "event": "synthetic_recovered_application_unverifiable",
                    "error_type": type(exc).__name__,
                    "sqlstate": getattr(getattr(exc, "orig", None), "sqlstate", None),
                }
            )
        )
        return 2
    print(json.dumps({"event": "synthetic_recovered_application_" + args.operation + "_verified"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
