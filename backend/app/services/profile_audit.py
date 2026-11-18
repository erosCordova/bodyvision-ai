"""Transactional, private expediente access audit.

The public synthetic demonstration is intentionally unchanged. Authenticated
operations use the same PostgreSQL transaction as the data they read or edit.
"""

from uuid import UUID, uuid4

from sqlalchemy import text

from app.models.context import Workspace

PROFILE_EVENTS = frozenset(
    {
        "profile.list",
        "profile.read",
        "profile.create",
        "profile.update",
        "profile.archive",
        "measurement.list",
        "measurement.read",
        "measurement.create",
        "measurement.correct",
        "analytics.read",
    }
)


def record_profile_event(scope: Workspace, action: str, profile_id: UUID | None) -> None:
    if not scope.authenticated:
        return
    if action not in PROFILE_EVENTS or scope.correlation_id is None:
        raise ValueError("Invalid private audit context")
    scope.connection.execute(
        text("SELECT record_private_profile_event(:event,:correlation,:profile,:action)"),
        {
            "event": uuid4(),
            "correlation": scope.correlation_id,
            "profile": profile_id,
            "action": action,
        },
    ).scalar_one()
