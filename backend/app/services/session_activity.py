"""Verified human-activity heartbeat, independent of refresh token rotation."""

from uuid import UUID

from fastapi import Request
from sqlalchemy import text

from app.core.errors import DomainError
from app.services.auth_sessions import resolve_identity, verified_session_digest


def acknowledge_private_activity(request: Request) -> None:
    """Update the authenticated session's activity only while it is live.

    The caller sends a bearer access token from memory; a cookie alone does
    not count as activity, and a stale session cannot be resurrected.
    """
    identity = resolve_identity(request)
    if request.headers.get("X-Workspace-ID"):
        raise DomainError(400, "UNTRUSTED_WORKSPACE", "No envíes un selector de organización.")
    digest = verified_session_digest(request)
    with request.app.state.auth_engine.begin() as connection:
        updated = connection.execute(
            text(
                "SELECT public.private_confirm_session_activity("
                "CAST(:digest AS char(64)))"
            ),
            {"digest": digest},
        ).scalar_one()
    if not updated:
        raise DomainError(401, "SESSION_IDLE_EXPIRED", "Sesión cerrada por inactividad.")
    request.state.operations_organization = UUID(str(identity.organization_id))
