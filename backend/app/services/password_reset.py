"""Administrator-assisted reset for synthetic accounts, not public recovery."""

from typing import Literal
from uuid import UUID, uuid4

from fastapi import Request
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from sqlalchemy import text

from app.core.errors import DomainError
from app.core.identity import (
    hash_password,
    hash_session_token,
    login_bucket_digest,
    verify_password,
)
from app.services.auth_sessions import DUMMY_VERIFIER, bearer_token, resolve_identity


class PasswordResetInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    administrator_password: SecretStr = Field(min_length=1, max_length=128)
    new_password: SecretStr = Field(min_length=12, max_length=128)


class PasswordResetRead(BaseModel):
    user_id: UUID
    status: Literal["reset"] = "reset"
    revoked_sessions: int


def reset_password(request: Request, user_id: UUID, data: PasswordResetInput) -> PasswordResetRead:
    identity = resolve_identity(request)
    if request.headers.get("X-Workspace-ID"):
        raise DomainError(400, "UNTRUSTED_WORKSPACE", "No envíes un selector de organización.")
    bucket = login_bucket_digest(identity.organization_id, f"password-reset:{identity.user_id}")
    administrator_verifier = None
    new_verifier = None
    if identity.role == "administrator":
        with request.app.state.auth_engine.begin() as limiter:
            allowed = limiter.execute(
                text("SELECT consume_auth_login_attempt(:org,CAST(:bucket AS char(64)))"),
                {"org": identity.organization_id, "bucket": bucket},
            ).scalar_one()
        if not allowed:
            raise DomainError(429, "RESET_RATE_LIMITED", "Demasiados intentos. Espera 15 minutos.")
        with request.app.state.auth_engine.begin() as connection:
            connection.execute(
                text("SELECT set_config('app.organization_id',:org,true)"),
                {"org": str(identity.organization_id)},
            )
            verifier = connection.execute(
                text("SELECT password_hash FROM users WHERE organization_id=:org AND id=:actor"),
                {"org": identity.organization_id, "actor": identity.user_id},
            ).scalar_one_or_none()
        valid = verify_password(
            data.administrator_password.get_secret_value(), verifier or DUMMY_VERIFIER
        )
        if valid and verifier:
            administrator_verifier = verifier
            new_verifier = hash_password(data.new_password.get_secret_value())
    with request.app.state.auth_engine.begin() as connection:
        result = connection.execute(
            text(
                "SELECT reset_synthetic_password(CAST(:digest AS char(64)),"
                ":user,:administrator,:new_verifier,:event,:correlation)"
            ),
            {
                "digest": hash_session_token(bearer_token(request)),
                "user": user_id,
                "administrator": administrator_verifier,
                "new_verifier": new_verifier,
                "event": uuid4(),
                "correlation": UUID(request.state.correlation_id),
            },
        ).scalar_one()
        if result["status"] == "reset":
            target_bucket = login_bucket_digest(identity.organization_id, result["login_email"])
            for cleared_bucket in (bucket, target_bucket):
                connection.execute(
                    text("SELECT clear_auth_login_attempts(:org,CAST(:bucket AS char(64)))"),
                    {"org": identity.organization_id, "bucket": cleared_bucket},
                ).scalar_one()
    # Denials commit their audit record before an HTTP error is returned.
    code = result["status"]
    if code == "forbidden":
        raise DomainError(403, "FORBIDDEN", "Solo un administrador puede restablecer accesos.")
    if code == "reauthentication-failed":
        raise DomainError(403, "RESET_REAUTH_REQUIRED", "Confirma la contraseña del administrador.")
    if code == "unauthorized":
        raise DomainError(401, "SESSION_EXPIRED", "La sesión ya no es válida.")
    if code != "reset":
        raise DomainError(404, "NOT_FOUND", "Cuenta de prueba no disponible para restablecimiento.")
    return PasswordResetRead(user_id=user_id, revoked_sessions=result["revoked_sessions"])
