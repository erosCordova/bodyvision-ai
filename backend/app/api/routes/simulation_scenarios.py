"""Isolated fictitious 3D scenario history. Never writes observed measurements."""

import hashlib
import json
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy import text

from app.api.deps import workspace
from app.core.errors import DomainError
from app.models.context import Workspace
from app.repositories import records
from app.schemas.scenarios import (
    ALGORITHM_REVISION,
    ATLAS_REVISION,
    ScenarioInput,
    ScenarioList,
    ScenarioRead,
)

router = APIRouter(prefix="/api/v1", tags=["Synthetic simulation scenarios"])
Scope = Annotated[Workspace, Depends(workspace, scope="function")]

FIELDS = """id,profile_id,series_id,version,prior_version_id,reference_kg,
 variation_percent,stature_cm,simulated_kg,model_revision,algorithm_revision,
 revision_note,created_by,created_at"""


def _scenario(scope: Workspace, profile_id: UUID, scenario_id: UUID) -> dict:
    row = (
        scope.connection.execute(
            text(f"""SELECT {FIELDS} FROM simulation_scenarios
          WHERE organization_id=:org AND profile_id=:profile AND id=:id"""),
            {"org": scope.organization_id, "profile": profile_id, "id": scenario_id},
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        raise DomainError(404, "NOT_FOUND", "Escenario ficticio no disponible.")
    return dict(row)


@router.get("/profiles/{profile_id}/scenarios", response_model=ScenarioList)
def list_scenarios(
    profile_id: UUID,
    scope: Scope,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    records.profile(scope, profile_id)
    params = {"org": scope.organization_id, "profile": profile_id, "limit": limit, "offset": offset}
    rows = (
        scope.connection.execute(
            text(f"""SELECT {FIELDS} FROM simulation_scenarios
          WHERE organization_id=:org AND profile_id=:profile
          ORDER BY created_at DESC,id DESC LIMIT :limit OFFSET :offset"""),
            params,
        )
        .mappings()
        .all()
    )
    total = scope.connection.execute(
        text("""SELECT count(*) FROM simulation_scenarios
          WHERE organization_id=:org AND profile_id=:profile"""),
        params,
    ).scalar_one()
    return {"items": [dict(row) for row in rows], "total": total, "limit": limit, "offset": offset}


@router.get(
    "/profiles/{profile_id}/scenarios/{scenario_id}/versions", response_model=list[ScenarioRead]
)
def scenario_versions(profile_id: UUID, scenario_id: UUID, scope: Scope):
    records.profile(scope, profile_id)
    selected = _scenario(scope, profile_id, scenario_id)
    return [
        dict(row)
        for row in scope.connection.execute(
            text(f"""SELECT {FIELDS} FROM simulation_scenarios
          WHERE organization_id=:org AND profile_id=:profile AND series_id=:series
          ORDER BY version ASC"""),
            {"org": scope.organization_id, "profile": profile_id, "series": selected["series_id"]},
        )
        .mappings()
        .all()
    ]


@router.post("/profiles/{profile_id}/scenarios", response_model=ScenarioRead, status_code=201)
def save_scenario(
    profile_id: UUID,
    data: ScenarioInput,
    scope: Scope,
    idempotency_key: Annotated[UUID, Header(alias="Idempotency-Key")],
):
    # Serializes writes for a fictitious profile and checks its write grant.
    # Append-only records and observations remain independent by construction.
    records.profile(scope, profile_id, write=True)
    payload = json.dumps(
        {"profile_id": str(profile_id), **data.model_dump(mode="json")},
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    key_params = {"org": scope.organization_id, "actor": scope.actor_id, "key": idempotency_key}
    existing = (
        scope.connection.execute(
            text("""SELECT request_hash,scenario_id FROM simulation_request_keys
          WHERE organization_id=:org AND actor_id=:actor AND key=:key"""),
            key_params,
        )
        .mappings()
        .one_or_none()
    )
    if existing:
        if existing["request_hash"] != digest:
            raise DomainError(
                409, "IDEMPOTENCY_CONFLICT", "La clave ya se utilizó para otro escenario."
            )
        return _scenario(scope, profile_id, existing["scenario_id"])

    new_id = uuid4()
    version = 1
    series = new_id
    if data.prior_version_id is not None:
        parent = _scenario(scope, profile_id, data.prior_version_id)
        has_successor = scope.connection.execute(
            text("""SELECT EXISTS(SELECT 1 FROM simulation_scenarios
              WHERE organization_id=:org AND prior_version_id=:parent)"""),
            {"org": scope.organization_id, "parent": data.prior_version_id},
        ).scalar_one()
        if has_successor:
            raise DomainError(
                409,
                "SCENARIO_VERSION_CONFLICT",
                "Esta versión ya tiene una sucesora. Actualiza el historial.",
            )
        series = parent["series_id"]
        version = parent["version"] + 1

    params = {
        "id": new_id,
        "org": scope.organization_id,
        "profile": profile_id,
        "series": series,
        "version": version,
        "prior": data.prior_version_id,
        "reference": data.reference_kg,
        "variation": data.variation_percent,
        "stature": data.stature_cm,
        "note": data.revision_note,
        "atlas": ATLAS_REVISION,
        "algorithm": ALGORITHM_REVISION,
        "actor": scope.actor_id,
    }
    created = (
        scope.connection.execute(
            text(f"""INSERT INTO simulation_scenarios
          (id,organization_id,profile_id,series_id,version,prior_version_id,
           reference_kg,variation_percent,stature_cm,revision_note,model_revision,
           algorithm_revision,created_by)
          VALUES (:id,:org,:profile,:series,:version,:prior,:reference,:variation,
                  :stature,:note,:atlas,:algorithm,:actor)
          RETURNING {FIELDS}"""),
            params,
        )
        .mappings()
        .one()
    )
    scope.connection.execute(
        text("""INSERT INTO simulation_request_keys
          (organization_id,actor_id,key,request_hash,scenario_id)
          VALUES (:org,:actor,:key,:digest,:scenario)"""),
        {**key_params, "digest": digest, "scenario": new_id},
    )
    return dict(created)
