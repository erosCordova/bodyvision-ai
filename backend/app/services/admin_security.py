"""Restricted synthetic-user administration and security audit.

Only active administrator sessions can provision specialist/member accounts;
organization is derived inside PostgreSQL from the authenticated session.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4

from fastapi import Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.core.errors import DomainError
from app.core.identity import hash_password, hash_session_token
from app.services.auth_sessions import bearer_token, resolve_identity


class NewSyntheticUser(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str = Field(min_length=3, max_length=100)
    email: str = Field(min_length=16, max_length=254, pattern=r"^[a-z0-9._%+-]+@example\.invalid$")
    password: str = Field(min_length=12, max_length=128)
    role: Literal["specialist", "member"]


class NewSyntheticUserRead(BaseModel):
    id: UUID
    organization_id: UUID
    display_name: str
    email: str
    role: Literal["specialist", "member"]
    status: Literal["active"] = "active"


class AuditEventRead(BaseModel):
    id: UUID
    actor_id: UUID | None
    action: str
    resource_type: str
    resource_id: UUID | None
    outcome: str
    happened_at: datetime
    actor_label: str | None = None
    target_label: str | None = None


def record_session_event(
    request: Request, connection, action: str, outcome: str = "allowed"
) -> None:
    digest = hash_session_token(bearer_token(request))
    connection.execute(
        text(
            "SELECT record_authenticated_security_event("
            "CAST(:digest AS char(64)),:event,:correlation,:action,:outcome)"
        ),
        {
            "digest": digest,
            "event": uuid4(),
            "correlation": UUID(request.state.correlation_id),
            "action": action,
            "outcome": outcome,
        },
    ).scalar_one()


def provision_user(request: Request, data: NewSyntheticUser) -> NewSyntheticUserRead:
    identity = resolve_identity(request)
    if identity.role != "administrator":
        with request.app.state.auth_engine.begin() as connection:
            record_session_event(request, connection, "admin.user_provision_denied", "denied")
        raise DomainError(403, "FORBIDDEN", "Solo un administrador puede crear usuarios.")

    user_id = uuid4()
    password_verifier = hash_password(data.password)
    with request.app.state.auth_engine.begin() as connection:
        result = connection.execute(
            text(
                "SELECT provision_synthetic_user("
                "CAST(:digest AS char(64)),:new_user,:new_role_id,"
                ":email,:name,:password_hash,:role,:event,:correlation)"
            ),
            {
                "digest": hash_session_token(bearer_token(request)),
                "new_user": user_id,
                "new_role_id": uuid4(),
                "email": data.email,
                "name": data.display_name,
                "password_hash": password_verifier,
                "role": data.role,
                "event": uuid4(),
                "correlation": UUID(request.state.correlation_id),
            },
        ).scalar_one()
    return NewSyntheticUserRead(
        id=result,
        organization_id=identity.organization_id,
        display_name=data.display_name.strip(),
        email=data.email,
        role=data.role,
    )


def list_security_events(request: Request, limit: int) -> list[AuditEventRead]:
    identity = resolve_identity(request)
    if identity.role != "administrator":
        with request.app.state.auth_engine.begin() as connection:
            record_session_event(request, connection, "admin.audit_denied", "denied")
        raise DomainError(403, "FORBIDDEN", "Acceso a auditoría no permitido.")

    with request.app.state.auth_engine.connect() as connection:
        rows = connection.execute(
            text("SELECT private_admin_audit(CAST(:digest AS char(64)),:limit)"),
            {"digest": hash_session_token(bearer_token(request)), "limit": limit},
        ).scalar_one()
    if isinstance(rows, dict):
        raise DomainError(403, "FORBIDDEN", "Acceso a auditoría no permitido.")
    return [AuditEventRead.model_validate(row) for row in rows]


class PermissionGrantInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    profile_id: UUID
    user_id: UUID
    access_level: Literal["read", "write", "manage"]


class PermissionRevokeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    profile_id: UUID
    user_id: UUID


class PermissionChangeRead(BaseModel):
    profile_id: UUID
    user_id: UUID
    status: Literal["granted", "revoked"]


def update_profile_permission(
    request: Request,
    profile_id: UUID,
    user_id: UUID,
    level: Literal["read", "write", "manage"] | None,
) -> PermissionChangeRead:
    identity = resolve_identity(request)
    if identity.role != "administrator":
        with request.app.state.auth_engine.begin() as connection:
            record_session_event(request, connection, "admin.permission_change_denied", "denied")
        raise DomainError(403, "FORBIDDEN", "Solo un administrador puede gestionar permisos.")

    with request.app.state.auth_engine.begin() as connection:
        result = connection.execute(
            text(
                "SELECT manage_private_profile_permission("
                "CAST(:digest AS char(64)),:profile,:subject,:level,"
                ":access_id,:event,:correlation)"
            ),
            {
                "digest": hash_session_token(bearer_token(request)),
                "profile": profile_id,
                "subject": user_id,
                "level": level,
                "access_id": uuid4(),
                "event": uuid4(),
                "correlation": UUID(request.state.correlation_id),
            },
        ).scalar_one()
    if result == "not-found":
        raise DomainError(404, "NOT_FOUND", "Destino de permisos no disponible.")
    return PermissionChangeRead(profile_id=profile_id, user_id=user_id, status=result)
