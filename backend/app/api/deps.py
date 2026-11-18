from collections.abc import Iterator
from typing import Annotated
from uuid import UUID

from fastapi import Header, Request
from sqlalchemy import text

from app.core.errors import DomainError
from app.models.context import FIRST_WORKSPACE, Workspace
from app.services.auth_sessions import resolve_identity


def workspace(
    request: Request, x_workspace_id: Annotated[UUID, Header()] = FIRST_WORKSPACE
) -> Iterator[Workspace]:
    # The private API obtains its tenant and actor ONLY from the verified
    # opaque session. The legacy selector remains demo/local-test-only.
    if request.app.state.settings.identity_enabled:
        identity = resolve_identity(request)
        if request.headers.get("X-Workspace-ID"):
            raise DomainError(400, "UNTRUSTED_WORKSPACE", "No envíes un selector de organización.")
        with request.app.state.engine.begin() as connection:
            connection.execute(
                text("SELECT set_config('app.organization_id',:org,true)"),
                {"org": str(identity.organization_id)},
            )
            connection.execute(
                text("SELECT set_config('app.actor_id',:actor,true)"),
                {"actor": str(identity.user_id)},
            )
            connection.execute(text("SELECT set_config('app.identity_verified','yes',true)"))
            yield Workspace(
                connection,
                identity.organization_id,
                identity.user_id,
                identity.role,
                True,
                UUID(request.state.correlation_id),
            )
        return

    # Legacy path: synthetic local/test selector, never real authentication.
    with request.app.state.engine.begin() as conn:
        conn.execute(
            text("SELECT set_config('app.organization_id', :id, true)"), {"id": str(x_workspace_id)}
        )
        actor = conn.execute(
            text("""
            SELECT u.id FROM users u JOIN organizations o ON o.id=u.organization_id
            WHERE o.id=:id AND o.synthetic AND u.is_local_operator
        """),
            {"id": x_workspace_id},
        ).scalar_one_or_none()
        if actor is None:
            raise DomainError(404, "NOT_FOUND", "Espacio ficticio no disponible.")
        conn.execute(text("SELECT set_config('app.actor_id', :id, true)"), {"id": str(actor)})
        yield Workspace(conn, x_workspace_id, actor)
