"""Private synthetic intake and safe review queue for subject-rights requests.

This only records requests. It never exports, erases, or claims legal fulfillment.
"""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text

from app.api.deps import workspace
from app.core.errors import DomainError
from app.models.context import Workspace
from app.repositories import records

router = APIRouter(prefix="/api/v1", tags=["Synthetic privacy requests"])
Scope = Annotated[Workspace, Depends(workspace, scope="function")]
REQUEST_TYPES = ("access", "rectification", "cancellation", "opposition", "export")
FIELDS = """r.id,r.profile_id,r.request_type,r.status,r.requested_by,r.received_at,
 r.review_target_at,r.review_started_at,r.reviewed_by,p.display_code AS profile_code,
 (r.status='received' AND r.review_target_at < clock_timestamp()) AS review_overdue"""
TABLE = """synthetic_privacy_requests r JOIN profiles p
  ON p.organization_id=r.organization_id AND p.id=r.profile_id"""


class PrivacyRequestInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_type: Literal["access", "rectification", "cancellation", "opposition", "export"]
    synthetic_confirmed: Literal[True]


class PrivacyRequestRead(BaseModel):
    id: UUID
    profile_id: UUID
    request_type: Literal["access", "rectification", "cancellation", "opposition", "export"]
    status: Literal["received", "in_review"]
    requested_by: UUID
    received_at: datetime
    review_target_at: datetime
    review_started_at: datetime | None
    reviewed_by: UUID | None
    profile_code: str
    review_overdue: bool


class PrivacyRequestPage(BaseModel):
    items: list[PrivacyRequestRead]
    total: int
    limit: int
    offset: int


def _require_private(scope: Workspace) -> None:
    if not scope.authenticated or scope.correlation_id is None:
        raise DomainError(
            403, "FORBIDDEN", "Disponible únicamente con identidad ficticia verificada."
        )


def _require_administrator(scope: Workspace) -> None:
    _require_private(scope)
    if scope.role != "administrator":
        raise DomainError(
            403, "FORBIDDEN", "Solo el administrador ficticio puede iniciar la revisión."
        )


def _audit(scope: Workspace, profile_id: UUID | None, event: str) -> None:
    scope.connection.execute(
        text("SELECT audit_synthetic_privacy_request(:event_id,:correlation,:profile,:action)"),
        {
            "event_id": uuid4(),
            "correlation": scope.correlation_id,
            "profile": profile_id,
            "action": event,
        },
    ).scalar_one()


def _read(scope: Workspace, identifier: UUID) -> dict:
    result = (
        scope.connection.execute(
            text(f"""SELECT {FIELDS} FROM {TABLE}
            WHERE r.id=:id AND r.organization_id=:org"""),
            {"id": identifier, "org": scope.organization_id},
        )
        .mappings()
        .one_or_none()
    )
    if result is None:
        raise DomainError(404, "NOT_FOUND", "Solicitud no disponible.")
    return dict(result)


@router.post(
    "/profiles/{profile_id}/privacy-requests",
    response_model=PrivacyRequestRead,
    status_code=201,
)
def submit_request(profile_id: UUID, data: PrivacyRequestInput, scope: Scope):
    _require_private(scope)
    records.profile(scope, profile_id)
    identifier = uuid4()
    scope.connection.execute(
        text("""INSERT INTO synthetic_privacy_requests
          (id,organization_id,profile_id,request_type,requested_by,review_target_at)
          VALUES (:id,:org,:profile,:type,:actor,clock_timestamp()+interval '7 days')"""),
        {
            "id": identifier,
            "org": scope.organization_id,
            "profile": profile_id,
            "type": data.request_type,
            "actor": scope.actor_id,
        },
    )
    _audit(scope, profile_id, "privacy.request.created")
    return _read(scope, identifier)


@router.get(
    "/profiles/{profile_id}/privacy-requests",
    response_model=PrivacyRequestPage,
)
def profile_requests(
    profile_id: UUID,
    scope: Scope,
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0, le=10000),
):
    _require_private(scope)
    records.profile(scope, profile_id)
    query = "WHERE r.organization_id=:org AND r.profile_id=:profile"
    params = {"org": scope.organization_id, "profile": profile_id, "limit": limit, "offset": offset}
    rows = (
        scope.connection.execute(
            text(f"""SELECT {FIELDS} FROM {TABLE}
        {query} ORDER BY r.received_at DESC,r.id DESC LIMIT :limit OFFSET :offset"""),
            params,
        )
        .mappings()
        .all()
    )
    total = scope.connection.execute(
        text(f"SELECT count(*) FROM synthetic_privacy_requests r {query}"), params
    ).scalar_one()
    _audit(scope, profile_id, "privacy.request.listed")
    return {"items": list(rows), "total": total, "limit": limit, "offset": offset}


@router.get("/privacy-requests", response_model=PrivacyRequestPage)
def review_queue(
    scope: Scope,
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0, le=10000),
    status: Literal["received", "in_review"] | None = Query(None),
    overdue_only: bool = Query(False),
):
    _require_administrator(scope)
    params = {
        "org": scope.organization_id,
        "actor": scope.actor_id,
        "limit": limit,
        "offset": offset,
        "filter_status": status,
        "overdue_only": overdue_only,
    }
    # Defense in depth: an administrator never inherits profile contents by role.
    # Apply the exact same explicit profile grant to both page and total.
    where = """WHERE r.organization_id=:org AND EXISTS (
      SELECT 1 FROM profile_access AS a
      WHERE a.organization_id=r.organization_id
        AND a.profile_id=r.profile_id
        AND a.user_id=:actor
        AND (a.expires_at IS NULL OR a.expires_at>now())
    )
    AND (:filter_status IS NULL OR r.status=:filter_status)
    AND (:overdue_only=false OR
         (r.status='received' AND r.review_target_at<clock_timestamp()))"""
    rows = (
        scope.connection.execute(
            text(f"""SELECT {FIELDS} FROM {TABLE} {where}
        ORDER BY CASE WHEN r.status='received' THEN 0 ELSE 1 END,
          r.review_target_at,r.id LIMIT :limit OFFSET :offset"""),
            params,
        )
        .mappings()
        .all()
    )
    total = scope.connection.execute(
        text(f"SELECT count(*) FROM synthetic_privacy_requests r {where}"), params
    ).scalar_one()
    _audit(scope, None, "privacy.queue.listed")
    return {"items": list(rows), "total": total, "limit": limit, "offset": offset}


@router.post("/privacy-requests/{request_id}/review", response_model=PrivacyRequestRead)
def start_review(request_id: UUID, scope: Scope):
    _require_administrator(scope)
    row = _read(scope, request_id)
    records.profile(scope, row["profile_id"])
    if not scope.connection.execute(
        text("SELECT has_profile_access(:profile,true)"),
        {"profile": row["profile_id"]},
    ).scalar_one():
        raise DomainError(404, "NOT_FOUND", "Solicitud no disponible.")
    if row["status"] != "received":
        raise DomainError(409, "CONFLICT", "La solicitud ya está en revisión.")
    changed = scope.connection.execute(
        text("SELECT start_synthetic_privacy_review(:id,:event,:correlation)"),
        {"id": request_id, "event": uuid4(), "correlation": scope.correlation_id},
    ).scalar_one()
    if not changed:
        raise DomainError(409, "CONFLICT", "La solicitud cambió. Actualiza la consulta.")
    return _read(scope, request_id)
