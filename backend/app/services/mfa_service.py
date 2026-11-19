"""Opt-in privileged TOTP enrollment and atomic step-up for synthetic accounts.

No privileged bearer is returned until the factor is confirmed. Recovery
verifiers and TOTP replay counters are mutated together with session issuance.
"""

import json
import re
import time
from typing import Literal
from uuid import UUID, uuid4

from fastapi import Request
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from sqlalchemy import text

from app.core.errors import DomainError
from app.core.identity import (
    issue_session_token,
    login_bucket_digest,
    verify_password,
)
from app.core.mfa import (
    decrypt_totp_seed,
    encrypt_totp_seed,
    hash_recovery_code,
    new_recovery_codes,
    new_totp_seed,
    totp_enrollment_uri,
    verify_recovery_code,
    verify_totp,
)
from app.services.auth_sessions import DUMMY_VERIFIER, SessionRead

PRIVILEGED_ROLES = {"administrator", "specialist"}
MFA_MISSING = "Debes configurar la verificación de dos factores antes de ingresar."
MFA_INVALID = "Código de verificación inválido, reutilizado o caducado."


class EnrollmentCredentials(BaseModel):
    model_config = ConfigDict(extra="forbid")

    organization_id: UUID
    email: str = Field(min_length=5, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: SecretStr = Field(min_length=1, max_length=128)


class EnrollmentConfirmation(EnrollmentCredentials):
    code: SecretStr = Field(min_length=6, max_length=6)


class EnrollmentRead(BaseModel):
    status: Literal["pending"] = "pending"
    otpauth_uri: str


class EnrollmentConfirmedRead(SessionRead):
    recovery_codes: list[str]


class RecoveryCredentials(EnrollmentCredentials):
    recovery_code: SecretStr = Field(min_length=32, max_length=64)


def _totp_now() -> int:
    return int(time.time())


def require_mfa_enabled(request: Request) -> str:
    settings = request.app.state.settings
    if not settings.identity_enabled or not settings.mfa_enabled:
        raise DomainError(404, "NOT_FOUND", "Recurso no disponible.")
    if settings.mfa_encryption_key is None:
        raise DomainError(503, "MFA_UNAVAILABLE", "Verificación temporalmente no disponible.")
    return settings.mfa_encryption_key.get_secret_value()


def _throttle(request: Request, organization: UUID, email: str) -> str:
    bucket = login_bucket_digest(organization, email)
    with request.app.state.auth_engine.begin() as limiter:
        permitted = limiter.execute(
            text("SELECT consume_auth_login_attempt(:org,CAST(:bucket AS char(64)))"),
            {"org": organization, "bucket": bucket},
        ).scalar_one()
    if not permitted:
        raise DomainError(429, "LOGIN_RATE_LIMITED", "Demasiados intentos. Espera 15 minutos.")
    return bucket


def _verify_password(connection, credentials: EnrollmentCredentials) -> tuple[UUID, str, str]:
    email = credentials.email.strip().lower()
    organization = credentials.organization_id
    connection.execute(
        text("SELECT set_config('app.organization_id',:org,true)"), {"org": str(organization)}
    )
    row = (
        connection.execute(
            text("""
            SELECT id,password_hash FROM users
            WHERE organization_id=:org AND lower(email)=:email
              AND account_status='active' AND NOT is_local_operator
            LIMIT 1
        """),
            {"org": organization, "email": email},
        )
        .mappings()
        .first()
    )
    verifier = row["password_hash"] if row and row["password_hash"] else DUMMY_VERIFIER
    if not verify_password(credentials.password.get_secret_value(), verifier) or row is None:
        raise DomainError(401, "INVALID_CREDENTIALS", "Credenciales inválidas.")
    return row["id"], verifier, email


def _snapshot(connection, organization: UUID, user: UUID, verifier: str) -> dict:
    return connection.execute(
        text("SELECT private_mfa_snapshot(:org,:actor,:verifier)"),
        {"org": organization, "actor": user, "verifier": verifier},
    ).scalar_one()


def _transition(
    request: Request,
    connection,
    organization: UUID,
    user: UUID,
    verifier: str,
    operation: str,
    *,
    ciphertext: str | None = None,
    step: int | None = None,
    recovery_id: UUID | None = None,
    recovery_verifier: str | None = None,
    recovery_codes: list[dict[str, str]] | None = None,
) -> None:
    result = connection.execute(
        text(
            "SELECT private_mfa_transition(:org,:actor,:verifier,:operation,"
            ":ciphertext,:step,:recovery_id,:recovery_verifier,CAST(:codes AS jsonb),"
            ":event,:correlation)"
        ),
        {
            "org": organization,
            "actor": user,
            "verifier": verifier,
            "operation": operation,
            "ciphertext": ciphertext,
            "step": step,
            "recovery_id": recovery_id,
            "recovery_verifier": recovery_verifier,
            "codes": json.dumps(recovery_codes) if recovery_codes is not None else None,
            "event": uuid4(),
            "correlation": UUID(request.state.correlation_id),
        },
    ).scalar_one()
    if result != "ok":
        raise DomainError(401, "MFA_CODE_INVALID", MFA_INVALID)


def _clear_throttle(connection, organization: UUID, bucket: str) -> None:
    connection.execute(
        text("SELECT clear_auth_login_attempts(:org,CAST(:bucket AS char(64)))"),
        {"org": organization, "bucket": bucket},
    ).scalar_one()


def _issue_verified_session(
    request: Request,
    connection,
    organization: UUID,
    user: UUID,
    verifier: str,
    bucket: str,
) -> SessionRead:
    token, digest = issue_session_token()
    session = connection.execute(
        text("SELECT issue_private_session(:org,:actor,:verifier,:id,CAST(:digest AS char(64)))"),
        {
            "org": organization,
            "actor": user,
            "verifier": verifier,
            "id": uuid4(),
            "digest": digest,
        },
    ).scalar_one()
    if session is None or session["role"] not in PRIVILEGED_ROLES:
        raise DomainError(401, "INVALID_CREDENTIALS", "Credenciales inválidas.")
    marked = connection.execute(
        text("SELECT private_mfa_mark_session(:org,:actor,:verifier,CAST(:digest AS char(64)))"),
        {"org": organization, "actor": user, "verifier": verifier, "digest": digest},
    ).scalar_one()
    if not marked:
        raise DomainError(401, "MFA_CODE_INVALID", MFA_INVALID)
    _clear_throttle(connection, organization, bucket)
    connection.execute(
        text(
            "SELECT record_authenticated_security_event("
            "CAST(:digest AS char(64)),:event,:correlation,'auth.login','allowed')"
        ),
        {
            "digest": digest,
            "event": uuid4(),
            "correlation": UUID(request.state.correlation_id),
        },
    ).scalar_one()
    return SessionRead(
        token=token,
        expires_at=session["expires_at"],
        organization_id=organization,
        user_id=user,
        role=session["role"],
    )


def begin_enrollment(request: Request, credentials: EnrollmentCredentials) -> EnrollmentRead:
    key = require_mfa_enabled(request)
    _throttle(request, credentials.organization_id, credentials.email.strip().lower())
    with request.app.state.auth_engine.begin() as connection:
        user, verifier, email = _verify_password(connection, credentials)
        snapshot = _snapshot(connection, credentials.organization_id, user, verifier)
        if snapshot["status"] == "denied":
            raise DomainError(403, "FORBIDDEN", "No puedes configurar este factor.")
        if snapshot["status"] == "enrolled":
            raise DomainError(409, "MFA_ALREADY_ENABLED", "La verificación ya está configurada.")
        seed = new_totp_seed()
        cipher = encrypt_totp_seed(seed, key)
        _transition(
            request,
            connection,
            credentials.organization_id,
            user,
            verifier,
            "begin",
            ciphertext=cipher,
        )
        # Do not clear the throttle on enrollment: password attempts remain bounded.
    return EnrollmentRead(otpauth_uri=totp_enrollment_uri(seed, email))


def confirm_enrollment(
    request: Request, credentials: EnrollmentConfirmation
) -> EnrollmentConfirmedRead:
    key = require_mfa_enabled(request)
    bucket = _throttle(request, credentials.organization_id, credentials.email.strip().lower())
    with request.app.state.auth_engine.begin() as connection:
        user, verifier, _ = _verify_password(connection, credentials)
        snapshot = _snapshot(connection, credentials.organization_id, user, verifier)
        if snapshot["status"] != "pending":
            raise DomainError(401, "MFA_CODE_INVALID", MFA_INVALID)
        seed = decrypt_totp_seed(snapshot["ciphertext"], key)
        accepted_step = verify_totp(seed, credentials.code.get_secret_value(), _totp_now())
        if accepted_step is None:
            raise DomainError(401, "MFA_CODE_INVALID", MFA_INVALID)
        codes = new_recovery_codes()
        encoded = [{"id": str(uuid4()), "verifier": hash_recovery_code(c)} for c in codes]
        _transition(
            request,
            connection,
            credentials.organization_id,
            user,
            verifier,
            "confirm",
            ciphertext=snapshot["ciphertext"],
            step=accepted_step,
            recovery_codes=encoded,
        )
        session = _issue_verified_session(
            request, connection, credentials.organization_id, user, verifier, bucket
        )
    return EnrollmentConfirmedRead(**session.model_dump(), recovery_codes=codes)


def begin_factor_recovery(
    request: Request, credentials: RecoveryCredentials
) -> EnrollmentRead:
    """Reset an enrolled factor using both the password and a one-use recovery code.

    The SQL operation serializes with session issuance. Every prior session and
    recovery verifier is revoked before a replacement seed is revealed.
    """
    key = require_mfa_enabled(request)
    _throttle(request, credentials.organization_id, credentials.email.strip().lower())
    with request.app.state.auth_engine.begin() as connection:
        user, verifier, email = _verify_password(connection, credentials)
        snapshot = _snapshot(connection, credentials.organization_id, user, verifier)
        if snapshot["status"] != "enrolled":
            raise DomainError(401, "MFA_CODE_INVALID", MFA_INVALID)
        matching = None
        code = credentials.recovery_code.get_secret_value()
        for item in snapshot["recovery"]:
            if verify_recovery_code(code, item["verifier"]):
                matching = item
                break
        if matching is None:
            raise DomainError(401, "MFA_CODE_INVALID", MFA_INVALID)

        replacement_seed = new_totp_seed()
        replacement_cipher = encrypt_totp_seed(replacement_seed, key)
        result = connection.execute(
            text(
                "SELECT private_mfa_reset_with_recovery("
                ":org,:actor,:verifier,:code_id,:code_verifier,:ciphertext,:event,:correlation)"
            ),
            {
                "org": credentials.organization_id,
                "actor": user,
                "verifier": verifier,
                "code_id": UUID(matching["id"]),
                "code_verifier": matching["verifier"],
                "ciphertext": replacement_cipher,
                "event": uuid4(),
                "correlation": UUID(request.state.correlation_id),
            },
        ).scalar_one()
        if result != "ok":
            raise DomainError(401, "MFA_CODE_INVALID", MFA_INVALID)
    return EnrollmentRead(otpauth_uri=totp_enrollment_uri(replacement_seed, email))


def require_login_mfa(
    request: Request,
    connection,
    organization: UUID,
    user: UUID,
    verifier: str,
    role: str,
    submitted: SecretStr | None,
) -> bool:
    if not request.app.state.settings.mfa_enabled or role not in PRIVILEGED_ROLES:
        return False
    key = require_mfa_enabled(request)
    snapshot = _snapshot(connection, organization, user, verifier)
    if snapshot["status"] in {"not-enrolled", "pending"}:
        raise DomainError(428, "MFA_SETUP_REQUIRED", MFA_MISSING)
    if snapshot["status"] != "enrolled":
        raise DomainError(401, "INVALID_CREDENTIALS", "Credenciales inválidas.")
    if submitted is None or not submitted.get_secret_value().strip():
        raise DomainError(401, "MFA_CODE_REQUIRED", "Introduce tu código de verificación.")
    code = submitted.get_secret_value().strip()
    if re.fullmatch(r"[0-9]{6}", code):
        seed = decrypt_totp_seed(snapshot["ciphertext"], key)
        accepted = verify_totp(seed, code, _totp_now(), last_accepted_step=snapshot["last_step"])
        if accepted is None:
            raise DomainError(401, "MFA_CODE_INVALID", MFA_INVALID)
        _transition(
            request,
            connection,
            organization,
            user,
            verifier,
            "totp",
            ciphertext=snapshot["ciphertext"],
            step=accepted,
        )
    else:
        matching = None
        for item in snapshot["recovery"]:
            if verify_recovery_code(code, item["verifier"]):
                matching = item
                break
        if matching is None:
            raise DomainError(401, "MFA_CODE_INVALID", MFA_INVALID)
        _transition(
            request,
            connection,
            organization,
            user,
            verifier,
            "recovery",
            recovery_id=UUID(matching["id"]),
            recovery_verifier=matching["verifier"],
        )
    return True
