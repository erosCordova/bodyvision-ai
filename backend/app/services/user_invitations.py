"""One-time invitations for strictly synthetic local/test tenant users.

No invitation emails are sent. The admin receives the secret once, and
PostgreSQL stores only its SHA-256 digest. Acceptance never creates a session.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4

from fastapi import Request
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from sqlalchemy import text

from app.core.errors import DomainError
from app.core.identity import (
    Role,
    hash_password,
    hash_session_token,
    issue_session_token,
)
from app.services.admin_confirmation import confirm_administrator
from app.services.auth_sessions import resolve_identity, verified_session_digest


class InvitationCreateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=16, max_length=254, pattern=r"^[a-z0-9._%+-]+@example\.invalid$")
    display_name: str = Field(min_length=3, max_length=100)
    role: Literal["specialist", "member"]
    administrator_password: SecretStr = Field(min_length=1, max_length=128)


class InvitationCreatedRead(BaseModel):
    id: UUID
    token: str
    expires_at: datetime
    role: Literal["specialist", "member"]


class InvitationAcceptInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=43, max_length=43)
    password: SecretStr = Field(min_length=12, max_length=128)


class InvitationAcceptedRead(BaseModel):
    user_id: UUID
    organization_id: UUID
    role: Literal["specialist", "member"]


class InvitationRow(BaseModel):
    id: UUID
    email: str
    display_name: str
    role: Literal["specialist", "member"]
    created_at: datetime
    expires_at: datetime
    status: Literal["pending", "expired", "accepted", "revoked"]


class InvitationListRead(BaseModel):
    items: list[InvitationRow]
    total: int
    limit: int
    offset: int


class InvitationRevokedRead(BaseModel):
    status: Literal["revoked"] = "revoked"


def _private_admin_request(request: Request) -> tuple[UUID, str, Role]:
    if not request.app.state.settings.identity_enabled:
        raise DomainError(404, "NOT_FOUND", "Recurso no disponible.")
    identity = resolve_identity(request)
    if request.headers.get("X-Workspace-ID"):
        raise DomainError(400, "UNTRUSTED_WORKSPACE", "No envíes un selector de organización.")
    if identity.role != "administrator":
        raise DomainError(403, "FORBIDDEN", "Solo un administrador puede gestionar invitaciones.")
    return identity.organization_id, verified_session_digest(request), identity.role


def create_invitation(request: Request, data: InvitationCreateInput) -> InvitationCreatedRead:
    _private_admin_request(request)
    identity = resolve_identity(request)
    expected_verifier, bucket = confirm_administrator(
        request, identity, data.administrator_password, "user-invite"
    )
    if expected_verifier is None:
        raise DomainError(
            403, "ACCOUNT_REAUTH_REQUIRED", "Confirma la contraseña del administrador."
        )
    invitation_id = uuid4()
    token, digest = issue_session_token()
    with request.app.state.auth_engine.begin() as connection:
        result = connection.execute(
            text(
                "SELECT public.private_create_synthetic_invitation("
                "CAST(:session AS char(64)),:invitation,CAST(:digest AS char(64)),"
                ":email,:name,:role,:verifier,:audit,:correlation)"
            ),
            {
                "session": verified_session_digest(request),
                "invitation": invitation_id,
                "digest": digest,
                "email": data.email,
                "name": data.display_name,
                "role": data.role,
                "verifier": expected_verifier,
                "audit": uuid4(),
                "correlation": UUID(request.state.correlation_id),
            },
        ).scalar_one()
        if result["status"] == "created":
            connection.execute(
                text("SELECT clear_auth_login_attempts(:org,CAST(:bucket AS char(64)))"),
                {"org": identity.organization_id, "bucket": bucket},
            ).scalar_one()
    if result["status"] == "already-exists":
        raise DomainError(409, "INVITATION_EXISTS", "La cuenta o invitación ya existe.")
    if result["status"] in {"unauthorized", "reauthentication-failed"}:
        raise DomainError(401, "SESSION_EXPIRED", "La sesión ya no es válida.")
    if result["status"] != "created":
        raise DomainError(400, "INVITATION_INVALID", "Datos de invitación no válidos.")
    return InvitationCreatedRead(
        id=invitation_id, token=token, expires_at=result["expires_at"], role=data.role
    )


def accept_invitation(request: Request, data: InvitationAcceptInput) -> InvitationAcceptedRead:
    if not request.app.state.settings.identity_enabled:
        raise DomainError(404, "NOT_FOUND", "Recurso no disponible.")
    if request.headers.get("X-Workspace-ID"):
        raise DomainError(400, "UNTRUSTED_WORKSPACE", "No envíes un selector de organización.")
    try:
        digest = hash_session_token(data.token)
    except (ValueError, UnicodeError):
        raise DomainError(401, "INVITATION_INVALID", "Invitación inválida o vencida.") from None
    # Check validity before the expensive Argon2id operation, then recheck
    # under the invitation row lock inside the atomic acceptance function.
    with request.app.state.auth_engine.connect() as connection:
        ready = connection.execute(
            text("SELECT public.private_synthetic_invitation_ready(CAST(:digest AS char(64)))"),
            {"digest": digest},
        ).scalar_one()
    if not ready:
        raise DomainError(401, "INVITATION_INVALID", "Invitación inválida o vencida.")
    verifier = hash_password(data.password.get_secret_value())
    with request.app.state.auth_engine.begin() as connection:
        result = connection.execute(
            text(
                "SELECT public.private_accept_synthetic_invitation("
                "CAST(:digest AS char(64)),:user,:role,:verifier,:audit,:correlation)"
            ),
            {
                "digest": digest,
                "user": uuid4(),
                "role": uuid4(),
                "verifier": verifier,
                "audit": uuid4(),
                "correlation": UUID(request.state.correlation_id),
            },
        ).scalar_one()
    if result["status"] != "accepted":
        raise DomainError(401, "INVITATION_INVALID", "Invitación inválida o vencida.")
    return InvitationAcceptedRead(
        user_id=result["user_id"],
        organization_id=result["organization_id"],
        role=result["role"],
    )


def list_invitations(request: Request, limit: int, offset: int) -> InvitationListRead:
    _, digest, _ = _private_admin_request(request)
    with request.app.state.auth_engine.connect() as connection:
        result = connection.execute(
            text(
                "SELECT public.private_list_synthetic_invitations("
                "CAST(:digest AS char(64)),:limit,:offset)"
            ),
            {"digest": digest, "limit": limit, "offset": offset},
        ).scalar_one()
    if result["status"] != "ok":
        raise DomainError(403, "FORBIDDEN", "No tienes acceso a esas invitaciones.")
    return InvitationListRead.model_validate(result)


def revoke_invitation(request: Request, invitation_id: UUID) -> InvitationRevokedRead:
    _, digest, _ = _private_admin_request(request)
    with request.app.state.auth_engine.begin() as connection:
        outcome = connection.execute(
            text(
                "SELECT public.private_revoke_synthetic_invitation("
                "CAST(:digest AS char(64)),:invitation,:audit,:correlation)"
            ),
            {
                "digest": digest,
                "invitation": invitation_id,
                "audit": uuid4(),
                "correlation": UUID(request.state.correlation_id),
            },
        ).scalar_one()
    if outcome == "unauthorized":
        raise DomainError(401, "SESSION_EXPIRED", "La sesión ya no es válida.")
    if outcome == "forbidden":
        raise DomainError(403, "FORBIDDEN", "Solo un administrador puede revocar.")
    if outcome != "revoked":
        raise DomainError(404, "NOT_FOUND", "Invitación no disponible.")
    return InvitationRevokedRead()
