from collections.abc import Iterator
from typing import Annotated
from uuid import UUID

from fastapi import Header, Request
from sqlalchemy import text

from app.core.errors import DomainError
from app.models.context import FIRST_WORKSPACE, Workspace


def workspace(
    request: Request, x_workspace_id: Annotated[UUID, Header()] = FIRST_WORKSPACE
) -> Iterator[Workspace]:
    # Local synthetic selector, NOT authentication. Production/staging remain blocked.
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
