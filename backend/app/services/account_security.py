"""Self-service account operations scoped exclusively to the verified bearer."""

from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4

from fastapi import Request
from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator
from sqlalchemy import text

from app.core.errors import DomainError
from app.core.identity import (
    hash_password,
    login_bucket_digest,
    verify_password,
)
from app.services.admin_security import record_session_event
from app.services.auth_sessions import DUMMY_VERIFIER, resolve_identity, verified_session_digest


class AccountConfirmation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: SecretStr = Field(min_length=1, max_length=128)


class OwnPasswordInput(AccountConfirmation):
    new_password: SecretStr = Field(min_length=12, max_length=128)

    @model_validator(mode="after")
    def require_different_password(self):
        if self.current_password.get_secret_value() == self.new_password.get_secret_value():
            raise ValueError("Choose a different password")
        return self


class OwnSessionRead(BaseModel):
    id: UUID
    issued_at: datetime
    expires_at: datetime
    current: bool


class OwnSessionsRead(BaseModel):
    items: list[OwnSessionRead]
    total: int
    limit: int
    offset: int
    checked_at: datetime


class OwnSecurityChangeRead(BaseModel):
    status: Literal["changed", "revoked"]
    revoked_sessions: int
    current_revoked: bool


class AuditIntegrityRead(BaseModel):
    valid: bool
    checked_events: int
    checkpoint_sequence: int
    checkpoint_hash: str
    first_invalid_sequence: int | None
    checked_at: datetime
    algorithm: Literal["sha256-chain-v1"]


def check_private_request(request: Request):
    identity = resolve_identity(request)
    if request.headers.get("X-Workspace-ID"):
        raise DomainError(400, "UNTRUSTED_WORKSPACE", "No envíes un selector de organización.")
    return identity


def list_own_sessions(request: Request, limit: int, offset: int) -> OwnSessionsRead:
    check_private_request(request)
    with request.app.state.auth_engine.connect() as connection:
        result = connection.execute(
            text("SELECT private_own_sessions(CAST(:digest AS char(64)),:limit,:offset)"),
            {"digest": verified_session_digest(request), "limit": limit, "offset": offset},
        ).scalar_one()
    if result.get("status") == "unauthorized":
        raise DomainError(401, "SESSION_EXPIRED", "La sesión ya no es válida.")
    return OwnSessionsRead.model_validate(result)


def change_own_security(
    request: Request,
    data: AccountConfirmation,
    operation: Literal["password", "session", "all-sessions"],
    session_id: UUID | None = None,
) -> OwnSecurityChangeRead:
    identity = check_private_request(request)
    bucket = login_bucket_digest(identity.organization_id, f"self-service:{identity.user_id}")
    # Failed confirmation and rolled-back mutations cannot erase throttling.
    with request.app.state.auth_engine.begin() as connection:
        permitted = connection.execute(
            text("SELECT consume_auth_login_attempt(:org,CAST(:bucket AS char(64)))"),
            {"org": identity.organization_id, "bucket": bucket},
        ).scalar_one()
    if not permitted:
        raise DomainError(429, "SELF_RATE_LIMITED", "Demasiados intentos. Espera 15 minutos.")
    with request.app.state.auth_engine.begin() as connection:
        connection.execute(
            text("SELECT set_config('app.organization_id',:org,true)"),
            {"org": str(identity.organization_id)},
        )
        verifier = connection.execute(
            text("SELECT password_hash FROM users WHERE organization_id=:org AND id=:actor"),
            {"org": identity.organization_id, "actor": identity.user_id},
        ).scalar_one_or_none()
    confirmed = verify_password(
        data.current_password.get_secret_value(), verifier or DUMMY_VERIFIER
    )
    new_verifier = (
        hash_password(data.new_password.get_secret_value())
        if confirmed and isinstance(data, OwnPasswordInput) and operation == "password"
        else None
    )
    with request.app.state.auth_engine.begin() as connection:
        result = connection.execute(
            text(
                "SELECT private_own_security_change(CAST(:digest AS char(64)),"
                ":operation,:session,:verifier,:new_verifier,:event,:correlation)"
            ),
            {
                "digest": verified_session_digest(request),
                "operation": operation,
                "session": session_id,
                "verifier": verifier if confirmed else None,
                "new_verifier": new_verifier,
                "event": uuid4(),
                "correlation": UUID(request.state.correlation_id),
            },
        ).scalar_one()
        if result["status"] in {"changed", "revoked"}:
            connection.execute(
                text("SELECT clear_auth_login_attempts(:org,CAST(:bucket AS char(64)))"),
                {"org": identity.organization_id, "bucket": bucket},
            ).scalar_one()
    # Commit denial evidence before returning an HTTP error.
    if result["status"] == "reauthentication-failed":
        raise DomainError(403, "SELF_REAUTH_REQUIRED", "Confirma tu contraseña actual.")
    if result["status"] == "unauthorized":
        raise DomainError(401, "SESSION_EXPIRED", "La sesión ya no es válida.")
    if result["status"] == "not-found":
        raise DomainError(404, "NOT_FOUND", "Sesión no disponible.")
    return OwnSecurityChangeRead.model_validate(result)


def verify_audit(request: Request) -> AuditIntegrityRead:
    identity = check_private_request(request)
    if identity.role != "administrator":
        with request.app.state.auth_engine.begin() as connection:
            record_session_event(request, connection, "admin.audit_denied", "denied")
        raise DomainError(403, "FORBIDDEN", "Solo un administrador puede verificar la auditoría.")
    with request.app.state.auth_engine.begin() as connection:
        result = connection.execute(
            text(
                "SELECT verify_private_audit_chain(CAST(:digest AS char(64)),:event,:correlation)"
            ),
            {
                "digest": verified_session_digest(request),
                "event": uuid4(),
                "correlation": UUID(request.state.correlation_id),
            },
        ).scalar_one()
    if result.get("status") == "unauthorized":
        raise DomainError(401, "SESSION_EXPIRED", "La sesión ya no es válida.")
    if result.get("status") == "forbidden":
        raise DomainError(403, "FORBIDDEN", "Acceso a auditoría no permitido.")
    return AuditIntegrityRead.model_validate(result)
