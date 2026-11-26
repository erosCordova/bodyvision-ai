"""Hosted synthetic sandbox with isolated per-account workspaces."""
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field
from typing import Literal
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
    with request.app.state.engine.begin() as connection:
        valid = connection.execute(text("""
            SELECT s.organization_id,s.user_id,COALESCE(a.role,'specialist') AS role, a.email, a.display_name FROM sandbox_sessions s LEFT JOIN sandbox_accounts a ON a.user_id=s.user_id AND a.organization_id=s.organization_id WHERE s.digest=:digest AND NOT s.revoked AND s.expires_at>now()
        """), {"digest": digest}).mappings().one_or_none()
        if valid is not None:
            connection.execute(text("UPDATE sandbox_sessions SET last_activity=now(), expires_at=now()+interval '30 days' WHERE digest=:digest AND NOT revoked AND expires_at>now() AND expires_at<now()+interval '29 days'"), {"digest":digest})
    if valid is None:
        raise DomainError(401, "SESSION_EXPIRED", "La sesión de pruebas caducó.")
    request.state.sandbox_verified = True
    request.state.sandbox_org = valid["organization_id"]
    request.state.sandbox_actor = valid["user_id"]
    request.state.sandbox_role = valid["role"]
    request.state.sandbox_email = valid["email"] or EMAIL
    request.state.sandbox_name = valid["display_name"] or request.state.sandbox_email.split("@")[0]
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
    role = "specialist"
    verifier = request.app.state.settings.sandbox_password_hash.get_secret_value()
    found = email == EMAIL
    if not found:
        with engine.connect() as connection:
            row = connection.execute(text("SELECT verifier,organization_id,user_id,role FROM sandbox_accounts WHERE email=:email"), {"email":email}).mappings().one_or_none()
        if row is not None:
            verifier, org, actor = row["verifier"], row["organization_id"], row["user_id"]
            role = row["role"]
            found = True
    salt, expected = verifier.split(":")
    actual = hashlib.pbkdf2_hmac("sha256", data.password.encode(), bytes.fromhex(salt), 600000).hex()
    if not (hmac.compare_digest(actual, expected) and found):
        sandbox_event(request,"auth.login",401)
        raise DomainError(401, "INVALID_CREDENTIALS", "Credenciales inválidas.")
    return issue_sandbox_session(request, org, actor, role)


def issue_sandbox_session(request: Request, org: UUID, actor: UUID, role: str) -> SessionRead:
    token = secrets.token_urlsafe(48)
    expiry = datetime.now(UTC) + timedelta(days=30)
    with request.app.state.engine.begin() as connection:
        connection.execute(text("INSERT INTO sandbox_sessions(digest,expires_at,organization_id,user_id) VALUES (:d,:e,:o,:u)"),
                           {"d": hashlib.sha256(token.encode()).hexdigest(), "e": expiry,"o":org,"u":actor})
    sandbox_event(request,"auth.login",200)
    return SessionRead(token=token, expires_at=expiry, organization_id=org, user_id=actor, role=role)


@router.get("/me")
def me(request: Request):
    check_sandbox_session(request)
    return {"email":request.state.sandbox_email,"display_name":request.state.sandbox_name,"role":request.state.sandbox_role,"user_id":request.state.sandbox_actor,"organization_id":request.state.sandbox_org}

class AdminAccountInput(BaseModel):
    email: str = Field(min_length=5,max_length=254,pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=12,max_length=128)
    display_name: str = Field(min_length=1,max_length=100)
    role: Literal["administrator","specialist","member","privacy_officer"]

def require_admin(request: Request):
    digest=check_sandbox_session(request)
    if request.state.sandbox_role!="administrator":
        raise DomainError(403,"FORBIDDEN","Solo el administrador puede gestionar usuarios.")
    return digest

@router.get("/admin/users")
def list_accounts(request:Request):
    require_admin(request)
    with request.app.state.engine.connect() as conn:
        rows=conn.execute(text("SELECT user_id,email,COALESCE(display_name,split_part(email,'@',1)) AS display_name,role,created_at FROM sandbox_accounts ORDER BY created_at DESC")).mappings().all()
    return {"items":[dict(row) for row in rows]}

@router.post("/admin/users",status_code=201)
def create_account(request: Request,data: AdminAccountInput):
    digest=require_admin(request)
    salt=secrets.token_bytes(16)
    verifier=salt.hex()+":"+hashlib.pbkdf2_hmac("sha256",data.password.encode(),salt,600000).hex()
    with request.app.state.engine.begin() as conn:
        created=conn.execute(text("SELECT sandbox_admin_create_account(:digest,:email,:verifier,:name,:role)"),{"digest":digest,"email":data.email.strip().lower(),"verifier":verifier,"name":data.display_name.strip(),"role":data.role}).scalar_one()
    if not created:
        raise DomainError(409,"REGISTRATION_UNAVAILABLE","El correo ya existe o se alcanzó el límite de cuentas.")
    sandbox_event(request,"auth.admin.create",201)
    return {"status":"created"}

@router.post("/register",status_code=403)
def register_disabled():
    raise DomainError(403,"REGISTRATION_DISABLED","Las cuentas las crea el administrador.")


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
        connection.execute(text("UPDATE sandbox_sessions SET last_activity=now() WHERE digest=:d AND NOT revoked AND expires_at>now()"), {"d":digest})
    return Response(status_code=204)
