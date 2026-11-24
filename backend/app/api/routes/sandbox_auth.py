"""Single-operator hosted sandbox. Only isolated synthetic fixtures; never private identity."""
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Request, Response
from sqlalchemy import text

from app.core.errors import DomainError
from app.models.context import FIRST_WORKSPACE
from app.services.auth_sessions import LoginInput, SessionRead

router = APIRouter(prefix="/api/v1/auth", tags=["Synthetic sandbox access"])
ACTOR = UUID("20000000-0000-4000-8000-000000000001")
EMAIL = "pruebas@bodyvision.invalid"


def sandbox_event(request: Request, action: str, status: int) -> None:
    with request.app.state.engine.begin() as connection:
        connection.execute(text("INSERT INTO sandbox_access_events(action,outcome,correlation_id) VALUES (:a,:s,:c)"),
                           {"a": action, "s": status, "c": UUID(request.state.correlation_id)})


def check_sandbox_session(request: Request) -> str:
    scheme, _, token = request.headers.get("Authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not 40 <= len(token) <= 100:
        raise DomainError(401, "AUTH_REQUIRED", "Inicia sesión.")
    digest = hashlib.sha256(token.encode()).hexdigest()
    with request.app.state.engine.connect() as connection:
        valid = connection.execute(text("""
            SELECT 1 FROM sandbox_sessions WHERE digest=:digest AND NOT revoked
            AND expires_at>now() AND last_activity>now()-interval '15 minutes'
        """), {"digest": digest}).scalar_one_or_none()
    if valid is None:
        raise DomainError(401, "SESSION_EXPIRED", "La sesión de pruebas caducó.")
    request.state.sandbox_verified = True
    return digest


@router.post("/login", response_model=SessionRead)
def login_sandbox(request: Request, data: LoginInput):
    engine = request.app.state.engine
    with engine.begin() as connection:
        allowed = connection.execute(text("""
            UPDATE sandbox_login_limit SET attempts=CASE WHEN window_start<now()-interval '15 minutes' THEN 1 ELSE attempts+1 END,
            window_start=CASE WHEN window_start<now()-interval '15 minutes' THEN now() ELSE window_start END
            WHERE singleton AND (attempts<10 OR window_start<now()-interval '15 minutes')
            RETURNING attempts
        """)).scalar_one_or_none()
    if allowed is None:
        raise DomainError(429, "LOGIN_RATE_LIMITED", "Intenta en 15 minutos.")
    salt, expected = request.app.state.settings.sandbox_password_hash.get_secret_value().split(":")
    actual = hashlib.pbkdf2_hmac("sha256", data.password.encode(), bytes.fromhex(salt), 600000).hex()
    if not (hmac.compare_digest(actual, expected) and data.email.strip().lower() == EMAIL and data.organization_id == FIRST_WORKSPACE):
        sandbox_event(request,"auth.login",401)
        raise DomainError(401, "INVALID_CREDENTIALS", "Credenciales inválidas.")
    token = secrets.token_urlsafe(48)
    expiry = datetime.now(UTC) + timedelta(hours=4)
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO sandbox_sessions(digest,expires_at) VALUES (:d,:e)"),
                           {"d": hashlib.sha256(token.encode()).hexdigest(), "e": expiry})
        connection.execute(text("UPDATE sandbox_login_limit SET attempts=0,window_start=now() WHERE singleton"))
    sandbox_event(request,"auth.login",200)
    return SessionRead(token=token, expires_at=expiry, organization_id=FIRST_WORKSPACE, user_id=ACTOR, role="specialist")


@router.post("/logout", status_code=204)
def logout_sandbox(request: Request):
    digest = check_sandbox_session(request)
    with request.app.state.engine.begin() as connection:
        connection.execute(text("UPDATE sandbox_sessions SET revoked=true WHERE digest=:d"), {"d":digest})
    sandbox_event(request,"auth.logout",204)
    return Response(status_code=204)


@router.post("/activity", status_code=204)
def activity_sandbox(request: Request):
    digest = check_sandbox_session(request)
    with request.app.state.engine.begin() as connection:
        connection.execute(text("UPDATE sandbox_sessions SET last_activity=now() WHERE digest=:d AND NOT revoked AND expires_at>now() AND last_activity>now()-interval '15 minutes'"), {"d":digest})
    return Response(status_code=204)
