"""Opt-in JWT exchange and revocation-aware validation for synthetic users."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import Request
from pydantic import BaseModel
from sqlalchemy import text

from app.core.access_tokens import (
    decode_signing_key,
    issue_access_token,
    verify_access_token,
)
from app.core.errors import DomainError
from app.core.identity import Identity, Role, hash_session_token
from app.services.account_security import list_own_sessions
from app.services.auth_sessions import bearer_token, resolve_identity


class AccessTokenRead(BaseModel):
    access_token: str
    token_type: Literal["Bearer"] = "Bearer"
    expires_at: datetime
    organization_id: UUID
    user_id: UUID
    role: Role


class AccessIdentityRead(BaseModel):
    organization_id: UUID
    user_id: UUID
    role: Role


def _signing_secret(request: Request) -> bytes:
    settings = request.app.state.settings
    if not settings.identity_enabled or not settings.jwt_access_enabled:
        raise DomainError(404, "NOT_FOUND", "Recurso no disponible.")
    # Startup validation guarantees a non-null, 256-bit, external secret.
    return decode_signing_key(settings.jwt_signing_key.get_secret_value())


def exchange_access_token(request: Request) -> AccessTokenRead:
    """Exchange a verified legacy session for a 15-minute access JWT.

    This never exposes the long-lived opaque secret in the response. The JWT
    is still tied to the original database session and revokes with it.
    """
    key = _signing_secret(request)
    identity = resolve_identity(request)
    sessions = list_own_sessions(request, 1, 0)
    if not sessions.items or not sessions.items[0].current:
        raise DomainError(401, "SESSION_EXPIRED", "La sesión ya no es válida.")
    try:
        access_token, expires_at = issue_access_token(
            key,
            identity,
            hash_session_token(bearer_token(request)),
            sessions.items[0].expires_at,
        )
    except ValueError:
        raise DomainError(401, "SESSION_EXPIRED", "La sesión ya no es válida.") from None
    return AccessTokenRead(
        access_token=access_token,
        expires_at=expires_at,
        organization_id=identity.organization_id,
        user_id=identity.user_id,
        role=identity.role,
    )


def resolve_access_identity(request: Request) -> Identity:
    """Verify signature and current DB session/MFA/role before granting access."""
    key = _signing_secret(request)
    header = request.headers.get("Authorization", "")
    scheme, separator, token = header.partition(" ")
    if separator != " " or scheme.lower() != "bearer" or not token:
        raise DomainError(401, "ACCESS_TOKEN_REQUIRED", "Se requiere un token de acceso.")
    try:
        claims = verify_access_token(token, key)
    except (ValueError, UnicodeError):
        raise DomainError(401, "ACCESS_TOKEN_INVALID", "Token de acceso inválido.") from None
    if request.headers.get("X-Workspace-ID"):
        raise DomainError(400, "UNTRUSTED_WORKSPACE", "No envíes un selector de organización.")
    with request.app.state.auth_engine.connect() as connection:
        row = (
            connection.execute(
                text("SELECT * FROM resolve_authenticated_session(CAST(:digest AS char(64)))"),
                {"digest": claims.session_digest},
            )
            .mappings()
            .first()
        )
        if (
            row is not None
            and (
                request.app.state.settings.mfa_enabled or row["assigned_role"] == "privacy_officer"
            )
            and row["assigned_role"] in {"administrator", "specialist", "privacy_officer"}
        ):
            verified = connection.execute(
                text("SELECT private_mfa_session_verified(CAST(:digest AS char(64)))"),
                {"digest": claims.session_digest},
            ).scalar_one()
            if not verified:
                raise DomainError(401, "MFA_REQUIRED", "Se requiere verificación de dos factores.")
    if (
        row is None
        or row["org_id"] != claims.organization_id
        or row["actor_id"] != claims.user_id
        or row["assigned_role"] != claims.role
    ):
        raise DomainError(401, "ACCESS_TOKEN_REVOKED", "La sesión ya no es válida.")
    request.state.operations_organization = row["org_id"]
    request.state.verified_session_digest = claims.session_digest
    return Identity(row["org_id"], row["actor_id"], row["assigned_role"], True)


def get_access_identity(request: Request) -> AccessIdentityRead:
    identity = resolve_access_identity(request)
    return AccessIdentityRead(
        organization_id=identity.organization_id,
        user_id=identity.user_id,
        role=identity.role,
    )
