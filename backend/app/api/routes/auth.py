"""Authenticated API endpoints (opt-in local/test environment only)."""

from uuid import UUID

from fastapi import APIRouter, Query, Request, Response, status

from app.services.account_security import (
    AccountConfirmation,
    AuditIntegrityRead,
    OwnPasswordInput,
    OwnSecurityChangeRead,
    OwnSessionsRead,
    change_own_security,
    list_own_sessions,
    verify_audit,
)
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
    rotate_session,
)
from app.services.consents import ConsentAcceptance, ConsentHistory, consent_operation
from app.services.cookie_access import cookie_login, cookie_logout, cookie_refresh
from app.services.jwt_access import (
    AccessIdentityRead,
    AccessTokenRead,
    exchange_access_token,
    get_access_identity,
)
from app.services.mfa_service import (
    EnrollmentConfirmation,
    EnrollmentConfirmedRead,
    EnrollmentCredentials,
    EnrollmentRead,
    RecoveryCredentials,
    begin_enrollment,
    begin_factor_recovery,
    confirm_enrollment,
)
from app.services.password_reset import PasswordResetInput, PasswordResetRead, reset_password
from app.services.user_management import (
    AccountStatusInput,
    AccountStatusRead,
    PermissionCatalog,
    UserDirectory,
    change_status,
    directory,
    permission_catalog,
)

router = APIRouter(prefix="/api/v1/auth", tags=["Authenticated identity"])


@router.post("/login", response_model=SessionRead)
def create_session(request: Request, data: LoginInput) -> SessionRead:
    return login(request, data)


@router.post("/access/login", response_model=AccessTokenRead)
def create_cookie_session(
    request: Request, response: Response, data: LoginInput
) -> AccessTokenRead:
    return cookie_login(request, response, data)


@router.post("/access/refresh", response_model=AccessTokenRead)
def renew_cookie_session(request: Request, response: Response) -> AccessTokenRead:
    return cookie_refresh(request, response)


@router.post("/access/logout", status_code=status.HTTP_204_NO_CONTENT)
def revoke_cookie_session(request: Request, response: Response) -> None:
    cookie_logout(request, response)


@router.post("/access/exchange", response_model=AccessTokenRead)
def exchange_private_access(request: Request) -> AccessTokenRead:
    return exchange_access_token(request)


@router.get("/access/me", response_model=AccessIdentityRead)
def get_access_session(request: Request) -> AccessIdentityRead:
    return get_access_identity(request)


@router.post("/mfa/enrollment", response_model=EnrollmentRead)
def start_mfa_enrollment(request: Request, data: EnrollmentCredentials) -> EnrollmentRead:
    return begin_enrollment(request, data)


@router.post("/mfa/confirm", response_model=EnrollmentConfirmedRead)
def confirm_mfa_enrollment(
    request: Request, data: EnrollmentConfirmation
) -> EnrollmentConfirmedRead:
    return confirm_enrollment(request, data)


@router.post("/mfa/recover", response_model=EnrollmentRead)
def recover_mfa_factor(request: Request, data: RecoveryCredentials) -> EnrollmentRead:
    return begin_factor_recovery(request, data)


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


@router.post("/sessions/rotate", response_model=SessionRead)
def rotate_current_session(request: Request) -> SessionRead:
    return rotate_session(request)


@router.get("/sessions", response_model=OwnSessionsRead)
def own_sessions(
    request: Request, limit: int = Query(20, ge=1, le=50), offset: int = Query(0, ge=0)
):
    return list_own_sessions(request, limit, offset)


@router.post("/sessions/revoke-all", response_model=OwnSecurityChangeRead)
def revoke_own_sessions(request: Request, data: AccountConfirmation):
    return change_own_security(request, data, "all-sessions")


@router.post("/sessions/{session_id}/revoke", response_model=OwnSecurityChangeRead)
def revoke_own_session(request: Request, session_id: UUID, data: AccountConfirmation):
    return change_own_security(request, data, "session", session_id)


@router.post("/password", response_model=OwnSecurityChangeRead)
def update_own_password(request: Request, data: OwnPasswordInput):
    return change_own_security(request, data, "password")


@router.post("/audit/verify", response_model=AuditIntegrityRead)
def verify_security_audit(request: Request):
    return verify_audit(request)


@router.post("/users", response_model=NewSyntheticUserRead, status_code=201)
def create_synthetic_user(request: Request, data: NewSyntheticUser) -> NewSyntheticUserRead:
    return provision_user(request, data)


@router.get("/users", response_model=UserDirectory)
def list_users(
    request: Request,
    search: str = Query("", max_length=100),
    limit: int = Query(50, ge=1, le=50),
    offset: int = Query(0, ge=0),
):
    return directory(request, search, limit, offset)


@router.get("/users/{user_id}/permission-catalog", response_model=PermissionCatalog)
def list_permission_choices(
    request: Request, user_id: UUID, search: str = Query("", max_length=100)
):
    return permission_catalog(request, user_id, search)


@router.post("/users/{user_id}/status", response_model=AccountStatusRead)
def update_account_status(request: Request, user_id: UUID, data: AccountStatusInput):
    return change_status(request, user_id, data)


@router.post("/users/{user_id}/reset-password", response_model=PasswordResetRead)
def reset_synthetic_user_password(
    request: Request, user_id: UUID, data: PasswordResetInput
) -> PasswordResetRead:
    return reset_password(request, user_id, data)


@router.get("/audit", response_model=list[AuditEventRead])
def audit_security(request: Request, limit: int = Query(30, ge=1, le=50)):
    return list_security_events(request, limit)


@router.post("/profile-access/grant", response_model=PermissionChangeRead)
def grant_profile_permission(request: Request, data: PermissionGrantInput) -> PermissionChangeRead:
    return update_profile_permission(request, data.profile_id, data.user_id, data.access_level)


@router.post("/profile-access/revoke", response_model=PermissionChangeRead)
def revoke_profile_permission(
    request: Request, data: PermissionRevokeInput
) -> PermissionChangeRead:
    return update_profile_permission(request, data.profile_id, data.user_id, None)


@router.get("/profiles/{profile_id}/consents", response_model=ConsentHistory)
def read_consents(request: Request, profile_id: UUID) -> ConsentHistory:
    return consent_operation(request, profile_id, "list")


@router.post("/profiles/{profile_id}/consents", response_model=ConsentHistory)
def accept_consent(request: Request, profile_id: UUID, data: ConsentAcceptance) -> ConsentHistory:
    return consent_operation(request, profile_id, "accept", purpose=data.purpose)


@router.post("/profiles/{profile_id}/consents/{consent_id}/revoke", response_model=ConsentHistory)
def revoke_consent(request: Request, profile_id: UUID, consent_id: UUID) -> ConsentHistory:
    return consent_operation(request, profile_id, "revoke", consent_id=consent_id)
