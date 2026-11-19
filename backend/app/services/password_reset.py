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
)
from app.services.admin_confirmation import confirm_administrator
from app.services.auth_sessions import bearer_token, resolve_identity


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
    administrator_verifier, bucket = confirm_administrator(
        request, identity, data.administrator_password, "password-reset"
    )
    new_verifier = (
        hash_password(data.new_password.get_secret_value()) if administrator_verifier else None
    )
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
