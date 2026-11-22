from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, Query, Request
from pydantic import AwareDatetime
from sqlalchemy import text

from app.api.deps import workspace
from app.core.errors import DomainError
from app.models.context import Workspace
from app.repositories import records
from app.schemas.core import (
    CorrectionInput,
    DerivedRead,
    MeasurementInput,
    MeasurementList,
    MeasurementRead,
    MetricRead,
    ProfileInput,
    ProfileList,
    ProfileRead,
    ProfileUpdate,
)
from app.services.measurements import derived, save
from app.services.measurement_versions import correction_history
from app.services.profile_audit import record_profile_event

router = APIRouter(prefix="/api/v1", tags=["Synthetic data core"])
Scope = Annotated[Workspace, Depends(workspace, scope="function")]


def require_writer(scope: Workspace) -> None:
    # Synthetic local/test behaviour is unchanged. Secure mode denies writes
    # to members even if a stale profile_access grant exists.
    if scope.authenticated and scope.role not in {"administrator", "specialist"}:
        raise DomainError(403, "FORBIDDEN", "No tienes permisos de edición.")


@router.get("/workspaces")
def workspaces(request: Request, scope: Scope) -> dict:
    if scope.authenticated:
        rows = (
            scope.connection.execute(
                text("SELECT id,name FROM list_local_workspaces() WHERE id=:org"),
                {"org": scope.organization_id},
            )
            .mappings()
            .all()
        )
    else:
        rows = (
            scope.connection.execute(text("SELECT * FROM list_local_workspaces()")).mappings().all()
        )
    return {
        "items": [dict(x) for x in rows],
        "synthetic": True,
        "read_only": request.app.state.settings.app_env == "demo",
        "notice": "Selector local de datos ficticios. No representa autenticación.",
    }


@router.get("/metrics/catalog", response_model=list[MetricRead])
def catalog(scope: Scope):
    return records.metrics(scope)


@router.get("/profiles", response_model=ProfileList)
def list_profiles(
    scope: Scope,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    search: str = Query("", max_length=100),
):
    condition = """organization_id=:org AND
        (display_code ILIKE :search OR COALESCE(display_name,'') ILIKE :search)"""
    params = {
        "org": scope.organization_id,
        "search": "%" + search + "%",
        "limit": limit,
        "offset": offset,
    }
    rows = (
        scope.connection.execute(
            text(
                f"SELECT * FROM profiles WHERE {condition} "
                "ORDER BY created_at DESC,id LIMIT :limit OFFSET :offset"
            ),
            params,
        )
        .mappings()
        .all()
    )
    total = scope.connection.execute(
        text(f"SELECT count(*) FROM profiles WHERE {condition}"), params
    ).scalar_one()
    record_profile_event(scope, "profile.list", None)
    return dict(items=[dict(x) for x in rows], total=total, limit=limit, offset=offset)


@router.post("/profiles", response_model=ProfileRead, status_code=201)
def create_profile(data: ProfileInput, scope: Scope):
    require_writer(scope)
    identifier = uuid4()
    params = data.model_dump()
    params.update(
        id=identifier,
        org=scope.organization_id,
        actor=scope.actor_id,
        code="BV-" + identifier.hex[:10].upper(),
    )
    scope.connection.execute(
        text("""INSERT INTO profiles
        (id,organization_id,display_code,display_name,birth_year,sex,created_by)
        VALUES (:id,:org,:code,:display_name,:birth_year,:sex,:actor)"""),
        params,
    )
    scope.connection.execute(
        text("""INSERT INTO profile_access
        (id,organization_id,profile_id,user_id,access_level)
        VALUES (:id,:org,:profile,:actor,'manage')"""),
        {
            "id": uuid4(),
            "org": scope.organization_id,
            "profile": identifier,
            "actor": scope.actor_id,
        },
    )
    result = records.profile(scope, identifier)
    record_profile_event(scope, "profile.create", identifier)
    return result


@router.get("/profiles/{profile_id}", response_model=ProfileRead)
def get_profile(profile_id: UUID, scope: Scope):
    result = records.profile(scope, profile_id)
    record_profile_event(scope, "profile.read", profile_id)
    return result


@router.patch("/profiles/{profile_id}", response_model=ProfileRead)
def update_profile(profile_id: UUID, data: ProfileUpdate, scope: Scope):
    require_writer(scope)
    current = records.profile(scope, profile_id)
    permitted = scope.connection.execute(
        text("SELECT has_profile_access(:id,true)"), {"id": profile_id}
    ).scalar_one()
    if not permitted:
        raise DomainError(404, "NOT_FOUND", "Expediente no disponible.")
    if current["status"] == "archived":
        raise DomainError(409, "CONFLICT", "El expediente archivado es de solo lectura.")
    fields = data.model_dump(exclude_unset=True)
    if not fields or ("status" in fields and fields["status"] is None):
        raise DomainError(422, "VALIDATION_ERROR", "Indica un cambio válido.")
    params = {"org": scope.organization_id, "id": profile_id, **fields}
    assignments = ",".join(key + "=:" + key for key in fields)
    scope.connection.execute(
        text(f"UPDATE profiles SET {assignments} WHERE id=:id AND organization_id=:org"), params
    )
    result = records.profile(scope, profile_id)
    record_profile_event(scope, "profile.update", profile_id)
    return result


@router.post("/profiles/{profile_id}/archive", response_model=ProfileRead)
def archive_profile(profile_id: UUID, scope: Scope):
    require_writer(scope)
    records.profile(scope, profile_id, write=True)
    scope.connection.execute(
        text("UPDATE profiles SET status='archived' WHERE id=:id AND organization_id=:org"),
        {"id": profile_id, "org": scope.organization_id},
    )
    result = records.profile(scope, profile_id)
    record_profile_event(scope, "profile.archive", profile_id)
    return result


@router.get("/profiles/{profile_id}/measurements", response_model=MeasurementList)
def list_measurements(
    profile_id: UUID,
    scope: Scope,
    metric_code: str | None = Query(None, max_length=40),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    records.profile(scope, profile_id)
    condition = """m.organization_id=:org AND m.profile_id=:id AND m.is_current
        AND (CAST(:metric AS text) IS NULL OR m.metric_code=:metric)"""
    params = {
        "org": scope.organization_id,
        "id": profile_id,
        "metric": metric_code,
        "limit": limit,
        "offset": offset,
    }
    rows = (
        scope.connection.execute(
            text(
                "SELECT m.*,u.display_name AS responsible FROM measurements m "
                "JOIN users u ON u.id=m.created_by AND u.organization_id=m.organization_id "
                f"WHERE {condition} ORDER BY m.measured_at DESC,m.created_at DESC,m.id "
                "LIMIT :limit OFFSET :offset"
            ),
            params,
        )
        .mappings()
        .all()
    )
    total = scope.connection.execute(
        text(f"SELECT count(*) FROM measurements m WHERE {condition}"), params
    ).scalar_one()
    record_profile_event(scope, "measurement.list", profile_id)
    return dict(items=[dict(x) for x in rows], total=total, limit=limit, offset=offset)


@router.post("/profiles/{profile_id}/measurements", response_model=MeasurementRead, status_code=201)
def create_measurement(
    profile_id: UUID,
    data: MeasurementInput,
    scope: Scope,
    idempotency_key: Annotated[UUID, Header(alias="Idempotency-Key")],
):
    require_writer(scope)
    result = save(scope, profile_id, data, idempotency_key)
    record_profile_event(scope, "measurement.create", profile_id)
    return result


@router.patch("/measurements/{measurement_id}", response_model=MeasurementRead, status_code=201)
def correct_measurement(
    measurement_id: UUID,
    data: CorrectionInput,
    scope: Scope,
    idempotency_key: Annotated[UUID, Header(alias="Idempotency-Key")],
):
    require_writer(scope)
    row = records.measurement(scope, measurement_id)
    result = save(scope, row["profile_id"], data, idempotency_key, measurement_id)
    record_profile_event(scope, "measurement.correct", row["profile_id"])
    return result


@router.get("/measurements/{measurement_id}/versions", response_model=list[MeasurementRead])
def versions(measurement_id: UUID, scope: Scope):
    """Backward-compatible response shape without scanning unrelated measurements."""
    result = correction_history(scope, measurement_id, limit=None)
    record_profile_event(scope, "measurement.read", result["items"][0]["profile_id"])
    return result["items"]


@router.get("/measurements/{measurement_id}/versions/page", response_model=MeasurementList)
def paginated_versions(
    measurement_id: UUID,
    scope: Scope,
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
):
    """Bounded page and exact total of an authorized immutable correction chain."""
    result = correction_history(scope, measurement_id, limit=limit, offset=offset)
    anchor = records.measurement(scope, measurement_id)
    record_profile_event(scope, "measurement.read", anchor["profile_id"])
    return result


@router.get("/profiles/{profile_id}/analytics/derived", response_model=list[DerivedRead])
def get_derived(profile_id: UUID, scope: Scope, as_of: AwareDatetime | None = None):
    result = derived(scope, profile_id, as_of)
    record_profile_event(scope, "analytics.read", profile_id)
    return result


@router.get("/profiles/{profile_id}/analytics/series", response_model=list[MeasurementRead])
def series(
    profile_id: UUID,
    scope: Scope,
    metric_code: str = Query("weight", max_length=40),
    period: Literal["30d", "90d", "1a", "all"] = "90d",
):
    rows = records.history(scope, profile_id, metric_code)
    days = {"30d": 30, "90d": 90, "1a": 365}.get(period)
    if days:
        cutoff = datetime.now(UTC) - timedelta(days=days)
        rows = [row for row in rows if row["measured_at"] >= cutoff]
    record_profile_event(scope, "analytics.read", profile_id)
    return rows


@router.get("/dashboard/summary")
def summary(scope: Scope) -> dict:
    conn = scope.connection
    org = {"org": scope.organization_id}
    active = conn.execute(
        text(
            "SELECT count(*) FROM profiles WHERE organization_id=:org "
            "AND status='active' AND has_profile_access(id)"
        ),
        org,
    ).scalar_one()
    measured = conn.execute(
        text(
            "SELECT count(*) FROM measurements WHERE organization_id=:org AND is_current "
            "AND measured_at>=now()-interval '30 days' AND has_profile_access(profile_id)"
        ),
        org,
    ).scalar_one()
    corrections = conn.execute(
        text(
            "SELECT count(*) FROM measurements WHERE organization_id=:org "
            "AND supersedes_id IS NOT NULL AND has_profile_access(profile_id)"
        ),
        org,
    ).scalar_one()
    recent = (
        conn.execute(
            text("""SELECT m.id,m.metric_code,c.label AS metric_label,
        m.value,m.unit,m.measured_at,m.method,
        p.id AS profile_id,p.display_code,u.display_name AS responsible FROM measurements m
        JOIN metric_catalog c ON c.code=m.metric_code AND c.organization_id=m.organization_id
        JOIN profiles p ON p.id=m.profile_id AND p.organization_id=m.organization_id
        JOIN users u ON u.id=m.created_by AND u.organization_id=m.organization_id
        WHERE m.organization_id=:org AND m.is_current
        AND has_profile_access(m.profile_id)
        ORDER BY m.created_at DESC,m.id LIMIT 8"""),
            org,
        )
        .mappings()
        .all()
    )
    return {
        "active_profiles": active,
        "measurements_30d": measured,
        "corrections": corrections,
        "recent_measurements": [{**dict(x), "data_type": "OBSERVADO"} for x in recent],
        "synthetic": True,
    }
