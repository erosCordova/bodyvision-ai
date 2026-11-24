"""Rehash only after complete authentication, in the same session transaction."""

from uuid import uuid4

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.errors import DomainError
from app.core.identity import hash_password, password_needs_upgrade


def upgrade_authenticated_password(
    request: Request, connection: Connection, session_digest: str, password: str, verifier: str
) -> None:
    if not password_needs_upgrade(verifier):
        return
    upgraded = connection.execute(
        text(
            "SELECT upgrade_private_password_verifier("
            "CAST(:digest AS char(64)),:previous,:current,:event,:correlation)"
        ),
        {
            "digest": session_digest,
            "previous": verifier,
            "current": hash_password(password),
            "event": uuid4(),
            "correlation": request.state.correlation_id,
        },
    ).scalar_one()
    if not upgraded:
        raise DomainError(401, "INVALID_CREDENTIALS", "Credenciales inválidas.")
