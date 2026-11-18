"""Private (local/test) session authentication using a distinct database role.

Never trusts X-Workspace-ID, email, or user IDs for authorization. Only a
server-verified opaque bearer token may select the active database tenant.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import Request
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.core.errors import DomainError
from app.core.identity import (
    Identity,
    hash_session_token,
    issue_session_token,
    login_bucket_digest,
    verify_password,
)

SESSION_LIFETIME_HOURS = 8


class LoginInput(BaseModel):
    organization_id: UUID
    email: str = Field(min_length=5, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=1, max_length=128)


class SessionRead(BaseModel):
    token: str
    expires_at: datetime
    organization_id: UUID
    user_id: UUID
    role: str


class IdentityRead(BaseModel):
    organization_id: UUID
    user_id: UUID
    role: str


# No recognizable account is a required first-user setup feature. This fake
# verifier keeps wrong-email and wrong-password paths in the same KDF family.
DUMMY_VERIFIER = (
    "pbkdf2_sha256$600000$00000000000000000000000000000000"
    "$185ea9b1250c78edb53095b2a8e56856cd8accaa3cda7b8a759a0689ead3fea7"
)


def bearer_token(request: Request) -> str:
    header = request.headers.get("Authorization", "")
    scheme, separator, token = header.partition(" ")
    if separator != " " or scheme.lower() != "bearer" or " " in token:
        raise DomainError(401, "AUTH_REQUIRED", "Se requiere una sesión válida.")
    try:
        hash_session_token(token)
    except (ValueError, UnicodeError):
        raise DomainError(401, "AUTH_REQUIRED", "Se requiere una sesión válida.") from None
    return token


def resolve_identity(request: Request) -> Identity:
    if not request.app.state.settings.identity_enabled:
        raise DomainError(404, "NOT_FOUND", "Recurso no disponible.")
    token = bearer_token(request)
    digest = hash_session_token(token)
    with request.app.state.auth_engine.connect() as connection:
        row = (
            connection.execute(
                text("SELECT * FROM resolve_authenticated_session(CAST(:digest AS char(64)))"),
                {"digest": digest},
            )
            .mappings()
            .first()
        )
    if row is None or row["assigned_role"] not in {
        "administrator",
        "specialist",
        "member",
    }:
        raise DomainError(401, "SESSION_EXPIRED", "La sesión ya no es válida.")
    return Identity(row["org_id"], row["actor_id"], row["assigned_role"], True)


def login(request: Request, credentials: LoginInput) -> SessionRead:
    if not request.app.state.settings.identity_enabled:
        raise DomainError(404, "NOT_FOUND", "Recurso no disponible.")
    email = credentials.email.strip().lower()
    digest_key = login_bucket_digest(credentials.organization_id, email)

    # Commit the rate-limit counter separately. Failed authentication below
    # rolls back its own SQL transaction, but must NOT erase the throttle state.
    with request.app.state.auth_engine.begin() as limiter:
        permitted = limiter.execute(
            text(
                "SELECT consume_auth_login_attempt(:org,CAST(:digest AS char(64)))"
            ),
            {"org": credentials.organization_id, "digest": digest_key},
        ).scalar_one()
    if not permitted:
        raise DomainError(
            429, "LOGIN_RATE_LIMITED",
            "Demasiados intentos de acceso. Intenta nuevamente en 15 minutos.",
        )

    with request.app.state.auth_engine.begin() as connection:
        connection.execute(
            text("SELECT set_config('app.organization_id',:org,true)"),
            {"org": str(credentials.organization_id)},
        )
        user = (
            connection.execute(
                text("""
                SELECT id,password_hash FROM users
                WHERE organization_id=:org AND lower(email)=:email
                  AND account_status='active' AND NOT is_local_operator
                LIMIT 1
            """),
                {"org": credentials.organization_id, "email": email},
            )
            .mappings()
            .first()
        )
        verifier = user["password_hash"] if user and user["password_hash"] else DUMMY_VERIFIER
        password_ok = verify_password(credentials.password, verifier)
        if user is None or not password_ok:
            raise DomainError(401, "INVALID_CREDENTIALS", "Credenciales inválidas.")
        user_id = user["id"]
        connection.execute(
            text("SELECT set_config('app.actor_id',:actor,true)"),
            {"actor": str(user_id)},
        )
        roles = connection.execute(
            text("""
                SELECT role FROM user_role_assignments
                WHERE organization_id=:org AND user_id=:actor
                  AND (expires_at IS NULL OR expires_at>now())
                ORDER BY CASE role
                  WHEN 'administrator' THEN 1
                  WHEN 'specialist' THEN 2 ELSE 3 END
                LIMIT 1
            """),
            {"org": credentials.organization_id, "actor": user_id},
        ).scalar_one_or_none()
        if roles is None:
            raise DomainError(401, "INVALID_CREDENTIALS", "Credenciales inválidas.")
        token, digest = issue_session_token()
        expires_at = datetime.now(UTC) + timedelta(hours=SESSION_LIFETIME_HOURS)
        connection.execute(
            text("""
                INSERT INTO auth_sessions
                  (id,organization_id,user_id,token_sha256,expires_at)
                VALUES (:id,:org,:actor,:digest,:expires_at)
            """),
            {
                "id": uuid4(),
                "org": credentials.organization_id,
                "actor": user_id,
                "digest": digest,
                "expires_at": expires_at,
            },
        )
        # Clear the counter only if the session insertion also commits.
        connection.execute(
            text("SELECT clear_auth_login_attempts(:org,CAST(:digest AS char(64)))"),
            {"org": credentials.organization_id, "digest": digest_key},
        ).scalar_one()
    return SessionRead(
        token=token,
        expires_at=expires_at,
        organization_id=credentials.organization_id,
        user_id=user_id,
        role=roles,
    )


def logout(request: Request) -> None:
    resolve_identity(request)
    digest = hash_session_token(bearer_token(request))
    with request.app.state.auth_engine.begin() as connection:
        connection.execute(
            text("SELECT revoke_authenticated_session(CAST(:digest AS char(64)))"),
            {"digest": digest},
        ).scalar_one()
