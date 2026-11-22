"""RLS-scoped correction history for one observed measurement.

PostgreSQL walks only the selected immutable correction lineage instead
of loading unrelated observations from the profile into Python memory.
"""
from uuid import UUID

from sqlalchemy import text

from app.models.context import Workspace
from app.repositories import records

_CHAIN_QUERY = text(
    """
    WITH RECURSIVE ancestors(id, prior_id, position, path) AS (
      SELECT m.id, m.supersedes_id, 0::integer, ARRAY[m.id]
        FROM measurements AS m
       WHERE m.id=:measurement AND m.organization_id=:org
         AND m.profile_id=:profile AND m.metric_code=:metric
      UNION ALL
      SELECT older.id, older.supersedes_id, a.position-1, a.path || older.id
        FROM ancestors AS a
        JOIN measurements AS older ON older.id=a.prior_id
       WHERE older.organization_id=:org AND older.profile_id=:profile
         AND older.metric_code=:metric AND NOT (older.id=ANY(a.path))
    ), descendants(id, position, path) AS (
      SELECT m.id, 0::integer, ARRAY[m.id]
        FROM measurements AS m
       WHERE m.id=:measurement AND m.organization_id=:org
         AND m.profile_id=:profile AND m.metric_code=:metric
      UNION ALL
      SELECT newer.id, d.position+1, d.path || newer.id
        FROM descendants AS d
        JOIN measurements AS newer ON newer.supersedes_id=d.id
       WHERE newer.organization_id=:org AND newer.profile_id=:profile
         AND newer.metric_code=:metric AND NOT (newer.id=ANY(d.path))
    ), lineage AS (
      SELECT id,position FROM ancestors
      UNION ALL
      SELECT id,position FROM descendants WHERE position>0
    ), slice AS (
      SELECT m.*,u.display_name AS responsible,l.position
        FROM lineage AS l
        JOIN measurements AS m ON m.id=l.id AND m.organization_id=:org
          AND m.profile_id=:profile AND m.metric_code=:metric
        JOIN users AS u ON u.id=m.created_by AND u.organization_id=m.organization_id
       ORDER BY l.position,m.id
       LIMIT :limit OFFSET :offset
    )
    SELECT (SELECT count(*) FROM lineage) AS total,
           COALESCE(
             (SELECT jsonb_agg(to_jsonb(s)-'position' ORDER BY s.position,s.id)
                FROM slice AS s),
             '[]'::jsonb
           ) AS items
    """
)


def correction_history(
    scope: Workspace,
    measurement_id: UUID,
    *,
    limit: int | None,
    offset: int = 0,
) -> dict:
    """Fetch only the chain visible to the authenticated profile member.

    limit=None preserves the old list endpoint for existing clients.
    New UI callers use limit <= 50 and never receive unrelated metric rows.
    """
    anchor = records.measurement(scope, measurement_id)
    result = scope.connection.execute(
        _CHAIN_QUERY,
        {
            "measurement": measurement_id,
            "org": scope.organization_id,
            "profile": anchor["profile_id"],
            "metric": anchor["metric_code"],
            "limit": limit,
            "offset": offset,
        },
    ).mappings().one()
    return {
        "items": result["items"],
        "total": result["total"],
        "limit": limit,
        "offset": offset,
    }
