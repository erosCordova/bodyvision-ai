"""Authenticated API endpoints (opt-in local/test environment only)."""

from fastapi import APIRouter, Request, status

from app.services.auth_sessions import (
    IdentityRead,
    LoginInput,
    SessionRead,
    login,
    logout,
    resolve_identity,
)

router = APIRouter(prefix="/api/v1/auth", tags=["Authenticated identity"])


@router.post("/login", response_model=SessionRead)
def create_session(request: Request, data: LoginInput) -> SessionRead:
    return login(request, data)


@router.get("/me", response_model=IdentityRead)
def get_session(request: Request) -> IdentityRead:
    identity = resolve_identity(request)
    return IdentityRead(
        organization_id=identity.organization_id,
        user_id=identity.user_id,
        role=identity.role,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def end_session(request: Request) -> None:
    logout(request)
