"""Private fictional summaries reported by local inference, not server-verified anatomy."""

import hashlib
import json
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy import text

from app.api.deps import workspace
from app.core.errors import DomainError
from app.models.context import Workspace
from app.repositories import records
from app.schemas.pose_summaries import (
    ALGORITHM_REVISION,
    PoseSummaryInput,
    PoseSummaryList,
    PoseSummaryRead,
)

router = APIRouter(prefix="/api/v1", tags=["Private fictional pose summaries"])
Scope = Annotated[Workspace, Depends(workspace, scope="function")]
FIELDS = """id,profile_id,created_by,created_at,model_revision,algorithm_revision,detected,
 threshold,visible_points,core_visible,quality_state,capture_passed,summary_sha256"""


def authorize(scope, profile, *, write=False, consent=True):
    if not scope.authenticated or (write and scope.role not in {"administrator", "specialist"}):
        raise DomainError(403, "FORBIDDEN", "Se requiere permiso privado para esta operación.")
    records.profile(scope, profile, write=write)
    if (
        consent
        and not scope.connection.execute(
            text("SELECT lock_pose_summary_consent(:profile)"), {"profile": profile}
        ).scalar_one()
    ):
        raise DomainError(
            403, "POSE_CONSENT_REQUIRED", "Registra aceptaciones vigentes de pose y conservación."
        )


def audit(scope, profile, action):
    scope.connection.execute(
        text("SELECT audit_pose_summary(:event,:correlation,:profile,:action)"),
        {
            "event": uuid4(),
            "correlation": scope.correlation_id,
            "profile": profile,
            "action": action,
        },
    ).scalar_one()


def summary(scope, profile, identifier):
    return (
        scope.connection.execute(
            text(f"""SELECT {FIELDS} FROM synthetic_pose_summaries
        WHERE organization_id=:org AND profile_id=:profile AND id=:id"""),
            {"org": scope.organization_id, "profile": profile, "id": identifier},
        )
        .mappings()
        .one_or_none()
    )


@router.get("/profiles/{profile_id}/pose-summaries", response_model=PoseSummaryList)
def history(
    profile_id: UUID,
    scope: Scope,
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0, le=10000),
):
    authorize(scope, profile_id)
    params = {"org": scope.organization_id, "profile": profile_id, "limit": limit, "offset": offset}
    items = (
        scope.connection.execute(
            text(f"""SELECT {FIELDS} FROM synthetic_pose_summaries
        WHERE organization_id=:org AND profile_id=:profile
        ORDER BY created_at DESC,id DESC LIMIT :limit OFFSET :offset"""),
            params,
        )
        .mappings()
        .all()
    )
    total = scope.connection.execute(
        text("""SELECT count(*) FROM synthetic_pose_summaries
        WHERE organization_id=:org AND profile_id=:profile"""),
        params,
    ).scalar_one()
    audit(scope, profile_id, "pose.list")
    return {"items": [dict(row) for row in items], "total": total, "limit": limit, "offset": offset}


@router.post(
    "/profiles/{profile_id}/pose-summaries", response_model=PoseSummaryRead, status_code=201
)
def save(
    profile_id: UUID,
    data: PoseSummaryInput,
    scope: Scope,
    idempotency_key: Annotated[UUID, Header(alias="Idempotency-Key")],
):
    authorize(scope, profile_id, write=True)
    canonical = {
        **data.model_dump(mode="json"),
        "threshold": float(data.threshold),
        "algorithm_revision": ALGORITHM_REVISION,
    }
    digest = hashlib.sha256(
        json.dumps(
            {"profile_id": str(profile_id), **canonical}, sort_keys=True, separators=(",", ":")
        ).encode()
    ).hexdigest()
    conn = scope.connection
    conn.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock,0))"),
        {"lock": f"pose:{scope.organization_id}:{scope.actor_id}:{idempotency_key}"},
    )
    keys = {"org": scope.organization_id, "actor": scope.actor_id, "key": idempotency_key}
    previous = (
        conn.execute(
            text("""SELECT * FROM pose_summary_request_keys
        WHERE organization_id=:org AND user_id=:actor AND key=:key"""),
            keys,
        )
        .mappings()
        .one_or_none()
    )
    if previous:
        if previous["profile_id"] != profile_id or previous["request_sha256"] != digest:
            raise DomainError(409, "CONFLICT", "La clave ya se usó con otro resumen.")
        result = summary(scope, profile_id, previous["result_id"])
        if result is None:
            raise DomainError(410, "POSE_SUMMARY_ERASED", "El resumen de este envío fue eliminado.")
        audit(scope, profile_id, "pose.read")
        return dict(result)
    identifier = uuid4()
    params = data.model_dump(exclude={"synthetic_confirmed"})
    params.update(
        id=identifier,
        org=scope.organization_id,
        profile=profile_id,
        actor=scope.actor_id,
        algorithm=ALGORITHM_REVISION,
        digest=digest,
    )
    conn.execute(
        text("""INSERT INTO synthetic_pose_summaries
      (id,organization_id,profile_id,created_by,model_revision,algorithm_revision,detected,
       threshold,visible_points,core_visible,quality_state,capture_passed,summary_sha256)
      VALUES (:id,:org,:profile,:actor,:model_revision,:algorithm,:detected,:threshold,
       :visible_points,:core_visible,:quality_state,:capture_passed,:digest)"""),
        params,
    )
    conn.execute(
        text("""INSERT INTO pose_summary_request_keys
      (organization_id,user_id,key,profile_id,result_id,request_sha256)
      VALUES (:org,:actor,:key,:profile,:result,:digest)"""),
        {**keys, "profile": profile_id, "result": identifier, "digest": digest},
    )
    audit(scope, profile_id, "pose.create")
    return dict(summary(scope, profile_id, identifier))


@router.delete("/profiles/{profile_id}/pose-summaries/{summary_id}", status_code=204)
def erase(profile_id: UUID, summary_id: UUID, scope: Scope):
    authorize(scope, profile_id, write=True, consent=False)
    removed = scope.connection.execute(
        text("SELECT erase_pose_summary(:profile,:id,:event,:correlation)"),
        {
            "profile": profile_id,
            "id": summary_id,
            "event": uuid4(),
            "correlation": scope.correlation_id,
        },
    ).scalar_one()
    if not removed:
        raise DomainError(404, "NOT_FOUND", "Resumen no disponible.")
    return Response(status_code=204)
