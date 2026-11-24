"""Hosted synthetic sandbox with isolated per-account workspaces."""
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field
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
            SELECT organization_id,user_id FROM sandbox_sessions WHERE digest=:digest AND NOT revoked
            AND expires_at>now() AND last_activity>now()-interval '15 minutes'
        """), {"digest": digest}).mappings().one_or_none()
    if valid is None:
        raise DomainError(401, "SESSION_EXPIRED", "La sesión de pruebas caducó.")
    request.state.sandbox_verified = True
    request.state.sandbox_org = valid["organization_id"]
    request.state.sandbox_actor = valid["user_id"]
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
    email = data.email.strip().lower()
    org, actor = FIRST_WORKSPACE, ACTOR
    verifier = request.app.state.settings.sandbox_password_hash.get_secret_value()
    found = email == EMAIL
    if not found:
        with engine.connect() as connection:
            row = connection.execute(text("SELECT verifier,organization_id,user_id FROM sandbox_accounts WHERE email=:email"), {"email":email}).mappings().one_or_none()
        if row is not None:
            verifier, org, actor = row["verifier"], row["organization_id"], row["user_id"]
            found = True
    salt, expected = verifier.split(":")
    actual = hashlib.pbkdf2_hmac("sha256", data.password.encode(), bytes.fromhex(salt), 600000).hex()
    if not (hmac.compare_digest(actual, expected) and found):
        sandbox_event(request,"auth.login",401)
        raise DomainError(401, "INVALID_CREDENTIALS", "Credenciales inválidas.")
    return issue_sandbox_session(request, org, actor)


def issue_sandbox_session(request: Request, org: UUID, actor: UUID) -> SessionRead:
    token = secrets.token_urlsafe(48)
    expiry = datetime.now(UTC) + timedelta(hours=4)
    with request.app.state.engine.begin() as connection:
        connection.execute(text("INSERT INTO sandbox_sessions(digest,expires_at,organization_id,user_id) VALUES (:d,:e,:o,:u)"),
                           {"d": hashlib.sha256(token.encode()).hexdigest(), "e": expiry,"o":org,"u":actor})
    sandbox_event(request,"auth.login",200)
    return SessionRead(token=token, expires_at=expiry, organization_id=org, user_id=actor, role="specialist")


class RegistrationInput(BaseModel):
    email: str = Field(min_length=5,max_length=254,pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=12,max_length=128)
    synthetic_only: bool


@router.post("/register",status_code=201)
def register_sandbox(request: Request, data: RegistrationInput):
    email = data.email.strip().lower()
    if not data.synthetic_only:
        raise DomainError(422,"SYNTHETIC_REQUIRED","Confirma el uso exclusivo de expedientes ficticios.")
    if email == EMAIL:
        raise DomainError(409,"REGISTRATION_UNAVAILABLE","No se pudo crear la cuenta.")
    engine=request.app.state.engine
    with engine.begin() as connection:
        allowed=connection.execute(text("""
          UPDATE sandbox_registration_limit SET attempts=CASE WHEN window_start<now()-interval '15 minutes' THEN 1 ELSE attempts+1 END,
          window_start=CASE WHEN window_start<now()-interval '15 minutes' THEN now() ELSE window_start END
          WHERE singleton AND (attempts<5 OR window_start<now()-interval '15 minutes') RETURNING attempts
        """)).scalar_one_or_none()
    if allowed is None:
        raise DomainError(429,"REGISTRATION_RATE_LIMITED","Intenta en 15 minutos.")
    salt=secrets.token_bytes(16)
    verifier=salt.hex()+":"+hashlib.pbkdf2_hmac("sha256",data.password.encode(),salt,600000).hex()
    with engine.begin() as connection:
        row=connection.execute(text("SELECT * FROM sandbox_register_account(:email,:verifier)"),{"email":email,"verifier":verifier}).mappings().one_or_none()
    if row is None:
        raise DomainError(409,"REGISTRATION_UNAVAILABLE","No se pudo crear la cuenta. Si ya tienes una, inicia sesión.")
    sandbox_event(request,"auth.register",201)
    return {"status":"created"}


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
