"""Authenticated API endpoints (opt-in local/test environment only)."""

from fastapi import APIRouter, Query, Request, status

from app.services.admin_security import (
    AuditEventRead,
    NewSyntheticUser,
    NewSyntheticUserRead,
    PermissionChangeRead,
    PermissionGrantInput,
    PermissionRevokeInput,
    list_security_events,
    provision_user,
    update_profile_permission,
)
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


@router.post("/users", response_model=NewSyntheticUserRead, status_code=201)
def create_synthetic_user(request: Request, data: NewSyntheticUser) -> NewSyntheticUserRead:
    return provision_user(request, data)


@router.get("/audit", response_model=list[AuditEventRead])
def audit_security(request: Request, limit: int = Query(30, ge=1, le=50)):
    return list_security_events(request, limit)


@router.post("/profile-access/grant", response_model=PermissionChangeRead)
def grant_profile_permission(
    request: Request, data: PermissionGrantInput
) -> PermissionChangeRead:
    return update_profile_permission(
        request, data.profile_id, data.user_id, data.access_level
    )


@router.post("/profile-access/revoke", response_model=PermissionChangeRead)
def revoke_profile_permission(
    request: Request, data: PermissionRevokeInput
) -> PermissionChangeRead:
    return update_profile_permission(request, data.profile_id, data.user_id, None)
