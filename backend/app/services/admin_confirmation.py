"""Shared, throttled administrator confirmation for private synthetic operations."""

from typing import Literal

from fastapi import Request
from pydantic import SecretStr
from sqlalchemy import text

from app.core.errors import DomainError
from app.core.identity import Identity, login_bucket_digest, verify_password
from app.services.auth_sessions import DUMMY_VERIFIER


def confirm_administrator(
    request: Request,
    identity: Identity,
    password: SecretStr,
    purpose: Literal["password-reset", "account-status", "user-invite"],
) -> tuple[str | None, str]:
    bucket = login_bucket_digest(identity.organization_id, f"{purpose}:{identity.user_id}")
    if identity.role != "administrator":
        return None, bucket
    with request.app.state.auth_engine.begin() as limiter:
        allowed = limiter.execute(
            text("SELECT consume_auth_login_attempt(:org,CAST(:bucket AS char(64)))"),
            {"org": identity.organization_id, "bucket": bucket},
        ).scalar_one()
    if not allowed:
        code = {
            "password-reset": "RESET_RATE_LIMITED",
            "account-status": "ACCOUNT_RATE_LIMITED",
            "user-invite": "INVITE_RATE_LIMITED",
        }[purpose]
        raise DomainError(429, code, "Demasiados intentos. Espera 15 minutos.")
    with request.app.state.auth_engine.begin() as connection:
        connection.execute(
            text("SELECT set_config('app.organization_id',:org,true)"),
            {"org": str(identity.organization_id)},
        )
        verifier = connection.execute(
            text("SELECT password_hash FROM users WHERE organization_id=:org AND id=:actor"),
            {"org": identity.organization_id, "actor": identity.user_id},
        ).scalar_one_or_none()
    valid = verify_password(password.get_secret_value(), verifier or DUMMY_VERIFIER)
    return (verifier if valid else None), bucket
