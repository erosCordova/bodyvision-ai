"""Organization-scoped user administration; no clinical record contents."""

from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4

from fastapi import Request
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from sqlalchemy import text

from app.core.errors import DomainError
from app.core.identity import hash_session_token, login_bucket_digest
from app.services.admin_confirmation import confirm_administrator
from app.services.auth_sessions import bearer_token, resolve_identity


class ManagedUser(BaseModel):
    id: UUID
    display_name: str
    email: str
    role: Literal["administrator", "specialist", "member", "unassigned"]
    status: Literal["active", "disabled", "locked"]
    manageable: bool


class UserDirectory(BaseModel):
    items: list[ManagedUser]
    total: int
    limit: int
    offset: int


class PermissionOption(BaseModel):
    id: UUID
    display_code: str
    status: Literal["active", "restricted", "archived"]
    access_level: Literal["read", "write", "manage"] | None
    expires_at: datetime | None
    effective: bool


class PermissionCatalog(BaseModel):
    items: list[PermissionOption]


class AccountStatusInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["active", "disabled"]
    administrator_password: SecretStr = Field(min_length=1, max_length=128)


class AccountStatusRead(BaseModel):
    user_id: UUID
    status: Literal["active", "disabled"]
    changed: bool
    revoked_sessions: int


def private_request(request: Request):
    identity = resolve_identity(request)
    if request.headers.get("X-Workspace-ID"):
        raise DomainError(400, "UNTRUSTED_WORKSPACE", "No envíes un selector de organización.")
    return identity, hash_session_token(bearer_token(request))


def directory(request: Request, search: str, limit: int, offset: int) -> UserDirectory:
    _, digest = private_request(request)
    with request.app.state.auth_engine.connect() as connection:
        result = connection.execute(
            text("SELECT private_admin_users(CAST(:digest AS char(64)),:search,:limit,:offset)"),
            {"digest": digest, "search": search, "limit": limit, "offset": offset},
        ).scalar_one()
    if result.get("error"):
        raise DomainError(403, "FORBIDDEN", "Directorio exclusivo de administradores.")
    return UserDirectory.model_validate(result)


def permission_catalog(request: Request, user_id: UUID, search: str) -> PermissionCatalog:
    _, digest = private_request(request)
    with request.app.state.auth_engine.connect() as connection:
        result = connection.execute(
            text("SELECT private_permission_catalog(CAST(:digest AS char(64)),:subject,:search)"),
            {"digest": digest, "subject": user_id, "search": search},
        ).scalar_one()
    if result.get("error") == "forbidden":
        raise DomainError(403, "FORBIDDEN", "Catálogo exclusivo de administradores.")
    if result.get("error"):
        raise DomainError(404, "NOT_FOUND", "Cuenta de prueba no disponible.")
    return PermissionCatalog.model_validate(result)


def change_status(request: Request, user_id: UUID, data: AccountStatusInput) -> AccountStatusRead:
    identity, digest = private_request(request)
    verifier, bucket = confirm_administrator(
        request, identity, data.administrator_password, "account-status"
    )
    with request.app.state.auth_engine.begin() as connection:
        result = connection.execute(
            text(
                "SELECT set_synthetic_account_status(CAST(:digest AS char(64)),"
                ":subject,:status,:verifier,:event,:correlation)"
            ),
            {
                "digest": digest,
                "subject": user_id,
                "status": data.status,
                "verifier": verifier,
                "event": uuid4(),
                "correlation": UUID(request.state.correlation_id),
            },
        ).scalar_one()
        if result["status"] in {"changed", "unchanged"}:
            buckets = [bucket]
            if data.status == "active":
                buckets.append(login_bucket_digest(identity.organization_id, result["login_email"]))
            for cleared in buckets:
                connection.execute(
                    text("SELECT clear_auth_login_attempts(:org,CAST(:bucket AS char(64)))"),
                    {"org": identity.organization_id, "bucket": cleared},
                ).scalar_one()
    state = result["status"]
    if state == "unauthorized":
        raise DomainError(401, "SESSION_EXPIRED", "La sesión ya no es válida.")
    if state == "reauthentication-failed":
        raise DomainError(
            403, "ACCOUNT_REAUTH_REQUIRED", "Confirma la contraseña del administrador."
        )
    if state == "forbidden":
        raise DomainError(403, "FORBIDDEN", "Solo un administrador puede gestionar cuentas.")
    if state == "not-found":
        raise DomainError(404, "NOT_FOUND", "Cuenta no disponible para esta operación.")
    return AccountStatusRead(
        user_id=user_id,
        status=data.status,
        changed=state == "changed",
        revoked_sessions=result["revoked_sessions"],
    )
