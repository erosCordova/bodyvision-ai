"""CSRF-guarded, HttpOnly refresh-cookie flow (synthetic local/test only).

Legacy bearer sessions remain available during migration of the frontend.
This cookie never appears in JSON or JavaScript and rotates on every refresh.
A replayed refresh token revokes its whole session family and the stale cookie
is removed from the browser before the 401 is returned.
"""

from datetime import UTC, datetime

from fastapi import Request, Response

from app.core.access_tokens import issue_access_token
from app.core.errors import DomainError
from app.core.identity import Identity, hash_session_token
from app.services.auth_sessions import (
    LoginInput,
    SessionRead,
    login,
    logout,
    rotate_session,
)
from app.services.jwt_access import AccessTokenRead, _signing_secret

REFRESH_COOKIE = "bv_private_refresh"
REFRESH_PATH = "/api/v1/auth/access"


def _same_origin_post(request: Request) -> None:
    # SameSite is an additional browser defense. Verify the actual Origin and
    # a custom header so ordinary cross-site forms cannot trigger rotation.
    expected = f"{request.url.scheme}://{request.url.netloc}"
    if (
        request.headers.get("Origin") != expected
        or request.headers.get("X-Requested-With") != "XMLHttpRequest"
    ):
        raise DomainError(403, "CSRF_REJECTED", "Solicitud de sesión no autorizada.")


def _set_refresh_cookie(request: Request, response: Response, session: SessionRead) -> None:
    lifetime = max(0, int((session.expires_at - datetime.now(UTC)).total_seconds()))
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=session.token,
        max_age=lifetime,
        path=REFRESH_PATH,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="strict",
    )


def _access_payload(request: Request, session: SessionRead) -> AccessTokenRead:
    key = _signing_secret(request)
    verified = Identity(session.organization_id, session.user_id, session.role, True)
    access, expiration = issue_access_token(
        key, verified, hash_session_token(session.token), session.expires_at
    )
    return AccessTokenRead(
        access_token=access,
        expires_at=expiration,
        organization_id=session.organization_id,
        user_id=session.user_id,
        role=session.role,
    )


def cookie_login(request: Request, response: Response, credentials: LoginInput) -> AccessTokenRead:
    _signing_secret(request)
    _same_origin_post(request)
    session = login(request, credentials)
    result = _access_payload(request, session)
    _set_refresh_cookie(request, response, session)
    return result


def cookie_refresh(request: Request, response: Response) -> AccessTokenRead:
    _signing_secret(request)
    _same_origin_post(request)
    token = request.cookies.get(REFRESH_COOKIE)
    if token is None:
        raise DomainError(401, "REFRESH_REQUIRED", "Inicia sesión nuevamente.")
    try:
        replacement = rotate_session(request, token_override=token)
    except DomainError as error:
        if error.code == "SESSION_REUSE_DETECTED":
            # Never keep replaying a credential the server just invalidated.
            raise DomainError(
                error.status,
                error.code,
                error.message,
                error.details,
                clear_cookies=((REFRESH_COOKIE, REFRESH_PATH),),
            ) from error
        raise
    result = _access_payload(request, replacement)
    _set_refresh_cookie(request, response, replacement)
    return result


def cookie_logout(request: Request, response: Response) -> None:
    _signing_secret(request)
    _same_origin_post(request)
    token = request.cookies.get(REFRESH_COOKIE)
    if token is None:
        raise DomainError(401, "REFRESH_REQUIRED", "Inicia sesión nuevamente.")
    logout(request, token_override=token)
    response.delete_cookie(key=REFRESH_COOKIE, path=REFRESH_PATH, samesite="strict")
