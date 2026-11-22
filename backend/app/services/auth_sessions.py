"""Private (local/test) session authentication using a distinct database role.

Never trusts X-Workspace-ID, email, or user IDs for authorization. Only a
server-verified opaque bearer token may select the active database tenant.
"""

from datetime import datetime
from uuid import UUID, uuid4

from fastapi import Request
from pydantic import BaseModel, Field, SecretStr
from sqlalchemy import text

from app.core.errors import DomainError
from app.core.identity import (
    Identity,
    Role,
    hash_session_token,
    issue_session_token,
    login_bucket_digest,
    verify_password,
)
from app.services.password_hashes import upgrade_authenticated_password


class LoginInput(BaseModel):
    organization_id: UUID
    email: str = Field(min_length=5, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=1, max_length=128)
    mfa_code: SecretStr | None = Field(default=None, max_length=64)


class SessionRead(BaseModel):
    token: str
    expires_at: datetime
    organization_id: UUID
    user_id: UUID
    role: Role


class IdentityRead(BaseModel):
    organization_id: UUID
    user_id: UUID
    role: Role


# Unknown accounts use the current KDF policy; legacy accounts retain their
# historical verification path until successful authenticated upgrade.
DUMMY_VERIFIER = (
    "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA"
    "$elRMODmdQvmhOQjrtA8tRI59xc4oOmWdW1Xkc3PlRAI"
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


def resolve_identity(request: Request, *, token_override: str | None = None) -> Identity:
    if not request.app.state.settings.identity_enabled:
        raise DomainError(404, "NOT_FOUND", "Recurso no disponible.")
    token = bearer_token(request) if token_override is None else token_override
    try:
        digest = hash_session_token(token)
    except (ValueError, UnicodeError):
        raise DomainError(401, "AUTH_REQUIRED", "Se requiere una sesión válida.") from None
    with request.app.state.auth_engine.connect() as connection:
        row = (
            connection.execute(
                text("SELECT * FROM resolve_authenticated_session(CAST(:digest AS char(64)))"),
                {"digest": digest},
            )
            .mappings()
            .first()
        )
        if (
            row is not None
            and request.app.state.settings.mfa_enabled
            and row["assigned_role"] in {"administrator", "specialist"}
        ):
            verified = connection.execute(
                text("SELECT private_mfa_session_verified(CAST(:digest AS char(64)))"),
                {"digest": digest},
            ).scalar_one()
            if not verified:
                raise DomainError(401, "MFA_REQUIRED", "Se requiere verificación de dos factores.")
    if row is None or row["assigned_role"] not in {
        "administrator",
        "specialist",
        "member",
    }:
        raise DomainError(401, "SESSION_EXPIRED", "La sesión ya no es válida.")
    # Scope diagnostics only after successful session and MFA verification.
    # Never infer this value from the client workspace selector.
    request.state.operations_organization = row["org_id"]
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
            text("SELECT consume_auth_login_attempt(:org,CAST(:digest AS char(64)))"),
            {"org": credentials.organization_id, "digest": digest_key},
        ).scalar_one()
    if not permitted:
        raise DomainError(
            429,
            "LOGIN_RATE_LIMITED",
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
        token, digest = issue_session_token()
        session_data = connection.execute(
            text(
                "SELECT issue_private_session(:org,:actor,:verifier,:id,CAST(:digest AS char(64)))"
            ),
            {
                "org": credentials.organization_id,
                "actor": user_id,
                "verifier": verifier,
                "id": uuid4(),
                "digest": digest,
            },
        ).scalar_one()
        if session_data is None:
            raise DomainError(401, "INVALID_CREDENTIALS", "Credenciales inválidas.")
        # Provisional token and factor counter commit together, never separately.
        from app.services.mfa_service import require_login_mfa

        stepped_up = require_login_mfa(
            request,
            connection,
            credentials.organization_id,
            user_id,
            verifier,
            session_data["role"],
            credentials.mfa_code,
        )
        if stepped_up:
            marked = connection.execute(
                text(
                    "SELECT private_mfa_mark_session("
                    ":org,:actor,:verifier,CAST(:digest AS char(64)))"
                ),
                {
                    "org": credentials.organization_id,
                    "actor": user_id,
                    "verifier": verifier,
                    "digest": digest,
                },
            ).scalar_one()
            if not marked:
                raise DomainError(401, "MFA_CODE_INVALID", "Verificación rechazada.")
        # Wrong/missing MFA has already failed; hash/session/audit commit together.
        upgrade_authenticated_password(request, connection, digest, credentials.password, verifier)
        # Clear the counter only if the session insertion also commits.
        connection.execute(
            text("SELECT clear_auth_login_attempts(:org,CAST(:digest AS char(64)))"),
            {"org": credentials.organization_id, "digest": digest_key},
        ).scalar_one()
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
        expires_at=session_data["expires_at"],
        organization_id=credentials.organization_id,
        user_id=user_id,
        role=session_data["role"],
    )


def logout(request: Request, *, token_override: str | None = None) -> None:
    resolve_identity(request, token_override=token_override)
    digest = hash_session_token(bearer_token(request) if token_override is None else token_override)
    with request.app.state.auth_engine.begin() as connection:
        # Audit the verified actor before revocation invalidates the token.
        connection.execute(
            text(
                "SELECT record_authenticated_security_event("
                "CAST(:digest AS char(64)),:event,:correlation,'auth.logout','allowed')"
            ),
            {
                "digest": digest,
                "event": uuid4(),
                "correlation": UUID(request.state.correlation_id),
            },
        ).scalar_one()
        connection.execute(
            text("SELECT revoke_authenticated_session(CAST(:digest AS char(64)))"),
            {"digest": digest},
        ).scalar_one()


def rotate_session(request: Request, *, token_override: str | None = None) -> SessionRead:
    """Consume one authenticated token and return its one-time replacement.

    The database serializes concurrent rotations, inherits MFA verification,
    and preserves the original session expiry. No token is returned until the
    revocation, insertion and audit event have committed.
    """
    resolve_identity(request, token_override=token_override)
    if request.headers.get("X-Workspace-ID"):
        raise DomainError(400, "UNTRUSTED_WORKSPACE", "No envíes un selector de organización.")
    old_digest = hash_session_token(
        bearer_token(request) if token_override is None else token_override
    )
    replacement, replacement_digest = issue_session_token()
    with request.app.state.auth_engine.begin() as connection:
        result = connection.execute(
            text(
                "SELECT public.private_rotate_session("
                "CAST(:old AS char(64)),CAST(:new AS char(64)),"
                ":session_id,:event_id,:correlation)"
            ),
            {
                "old": old_digest,
                "new": replacement_digest,
                "session_id": uuid4(),
                "event_id": uuid4(),
                "correlation": UUID(request.state.correlation_id),
            },
        ).scalar_one()
    if result["status"] == "relogin-required":
        raise DomainError(401, "SESSION_RELOGIN_REQUIRED", "Inicia sesión nuevamente.")
    if result["status"] != "rotated":
        raise DomainError(401, "SESSION_EXPIRED", "La sesión ya no es válida.")
    return SessionRead(
        token=replacement,
        expires_at=result["expires_at"],
        organization_id=result["organization_id"],
        user_id=result["user_id"],
        role=result["role"],
    )
