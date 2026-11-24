"""Synthetic server pose queue, separate from browser-reported pose summaries."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text

from app.api.deps import workspace
from app.api.routes import synthetic_captures
from app.core.errors import DomainError
from app.models.context import Workspace
from app.repositories import records
from app.services.server_pose_inference import PoseResult

router = APIRouter(prefix="/api/v1", tags=["Synthetic server pose queue"])
Scope = Annotated[Workspace, Depends(workspace, scope="function")]
FIELDS = """id,profile_id,capture_id,status,attempts,created_at,
 finished_at,reviewed_at,result,error_code"""


class JobRead(BaseModel):
    id: UUID
    profile_id: UUID
    capture_id: UUID
    status: Literal["queued", "processing", "needs_review", "failed", "accepted", "rejected"]
    attempts: int
    created_at: datetime
    finished_at: datetime | None
    reviewed_at: datetime | None
    result: PoseResult | None
    error_code: str | None
    origin: Literal["server_model"] = "server_model"
    synthetic: Literal[True] = True


class QueueInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    synthetic_confirmed: Literal[True]


class ReviewInput(QueueInput):
    decision: Literal["accepted", "rejected"]


def _authorize(scope: Workspace, request: Request, profile: UUID, write: bool = False):
    synthetic_captures._cipher(request)
    if not scope.authenticated or (
        write and scope.role not in {"administrator", "specialist"}
    ):
        raise DomainError(403, "FORBIDDEN", "Se requiere un permiso privado de prueba.")
    records.profile(scope, profile, write=write)
    synthetic_captures._consented(scope, profile)
    if not scope.connection.execute(
        text("SELECT lock_pose_summary_consent(:profile)"), {"profile": profile}
    ).scalar_one():
        raise DomainError(403, "POSE_CONSENT_REQUIRED", "Se requiere consentimiento de pose.")


def _get(scope: Workspace, profile: UUID, capture: UUID) -> dict:
    row = (
        scope.connection.execute(
            text(f"""SELECT {FIELDS} FROM server_pose_jobs
              WHERE organization_id=:org AND profile_id=:profile AND capture_id=:capture"""),
            {"org": scope.organization_id, "profile": profile, "capture": capture},
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        raise DomainError(404, "NOT_FOUND", "Trabajo de pose no disponible.")
    return dict(row)


@router.get("/profiles/{profile_id}/captures/{capture_id}/server-pose", response_model=JobRead)
def get_job(profile_id: UUID, capture_id: UUID, scope: Scope, request: Request):
    _authorize(scope, request, profile_id)
    row = _get(scope, profile_id, capture_id)
    synthetic_captures._audit(scope, "capture.read", profile_id)
    return row


@router.post(
    "/profiles/{profile_id}/captures/{capture_id}/server-pose",
    response_model=JobRead,
    status_code=202,
)
def enqueue(profile_id: UUID, capture_id: UUID, data: QueueInput, scope: Scope, request: Request):
    _authorize(scope, request, profile_id, write=True)
    identifier = scope.connection.execute(
        text("SELECT enqueue_server_pose(:id,:profile,:capture,:event,:correlation)"),
        {
            "id": uuid4(),
            "profile": profile_id,
            "capture": capture_id,
            "event": uuid4(),
            "correlation": scope.correlation_id,
        },
    ).scalar_one()
    if identifier is None:
        raise DomainError(404, "NOT_FOUND", "Captura ficticia no disponible.")
    return _get(scope, profile_id, capture_id)


@router.post(
    "/profiles/{profile_id}/captures/{capture_id}/server-pose/review",
    response_model=JobRead,
)
def review(profile_id: UUID, capture_id: UUID, data: ReviewInput, scope: Scope, request: Request):
    _authorize(scope, request, profile_id, write=True)
    job = _get(scope, profile_id, capture_id)
    changed = scope.connection.execute(
        text("SELECT review_server_pose(:id,:decision,:event,:correlation)"),
        {
            "id": job["id"],
            "decision": data.decision,
            "event": uuid4(),
            "correlation": scope.correlation_id,
        },
    ).scalar_one()
    if not changed:
        raise DomainError(409, "CONFLICT", "La decisión no es válida para el estado actual.")
    return _get(scope, profile_id, capture_id)
