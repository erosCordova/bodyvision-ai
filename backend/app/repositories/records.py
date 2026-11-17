from uuid import UUID

from sqlalchemy import text

from app.core.errors import DomainError
from app.models.context import Workspace


def profile(scope: Workspace, profile_id: UUID, write: bool = False) -> dict:
    query = """
        SELECT p.* FROM profiles p JOIN profile_access a ON a.profile_id=p.id
          AND a.organization_id=p.organization_id
        WHERE p.id=:id AND p.organization_id=:org AND a.user_id=:actor
          AND (a.expires_at IS NULL OR a.expires_at>now())
          AND (NOT :write OR a.access_level IN ('write','manage'))
    """
    if write:
        query += " FOR UPDATE OF p"
    row = (
        scope.connection.execute(
            text(query),
            {
                "id": profile_id,
                "org": scope.organization_id,
                "actor": scope.actor_id,
                "write": write,
            },
        )
        .mappings()
        .first()
    )
    if row is None:
        raise DomainError(404, "NOT_FOUND", "Expediente no disponible.")
    if write and row["status"] != "active":
        raise DomainError(409, "CONFLICT", "Este expediente está en modo de solo lectura.")
    return dict(row)


def metrics(scope: Workspace) -> list[dict]:
    return [
        dict(x)
        for x in scope.connection.execute(
            text("""
        SELECT code,label,unit,min_value,max_value,allowed_methods,precision,instructions
        FROM metric_catalog WHERE organization_id=:org ORDER BY position
    """),
            {"org": scope.organization_id},
        ).mappings()
    ]


def measurement(scope: Workspace, measurement_id: UUID, lock: bool = False) -> dict:
    query = """SELECT m.*,u.display_name AS responsible FROM measurements m
        JOIN users u ON u.id=m.created_by AND u.organization_id=m.organization_id
        WHERE m.id=:id AND m.organization_id=:org"""
    if lock:
        query += " FOR UPDATE OF m"
    row = (
        scope.connection.execute(text(query), {"id": measurement_id, "org": scope.organization_id})
        .mappings()
        .first()
    )
    if row is None:
        raise DomainError(404, "NOT_FOUND", "Medición no disponible.")
    profile(scope, row["profile_id"])
    return dict(row)


def history(scope: Workspace, profile_id: UUID, metric_code: str | None = None) -> list[dict]:
    profile(scope, profile_id)
    return [
        dict(x)
        for x in scope.connection.execute(
            text("""
        SELECT m.*,u.display_name AS responsible FROM measurements m
        JOIN users u ON u.id=m.created_by AND u.organization_id=m.organization_id
        WHERE m.organization_id=:org AND m.profile_id=:id AND m.is_current
          AND (CAST(:metric AS text) IS NULL OR m.metric_code=:metric)
        ORDER BY m.measured_at,m.created_at,m.id
    """),
            {"org": scope.organization_id, "id": profile_id, "metric": metric_code},
        ).mappings()
    ]
