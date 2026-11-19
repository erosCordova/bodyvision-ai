"""Transactional, scoped audit of simulated scenarios in private synthetic mode."""

from uuid import UUID, uuid4

from sqlalchemy import text

from app.models.context import Workspace

ACTIONS = frozenset({"simulation.create", "simulation.list", "simulation.read"})


def record_simulation_event(scope: Workspace, action: str, profile_id: UUID) -> None:
    if not scope.authenticated:
        return
    if action not in ACTIONS or scope.correlation_id is None:
        raise ValueError("Invalid private simulation audit context")
    scope.connection.execute(
        text("SELECT record_private_simulation_event(:event,:correlation,:profile,:action)"),
        {
            "event": uuid4(),
            "correlation": scope.correlation_id,
            "profile": profile_id,
            "action": action,
        },
    ).scalar_one()
