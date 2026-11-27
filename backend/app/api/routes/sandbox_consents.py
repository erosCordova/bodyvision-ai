"""Synthetic consent workflow. No legal signature or biometric identity record."""

from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, StrictBool
from sqlalchemy import text

from app.api.deps import workspace
from app.core.errors import DomainError
from app.models.context import Workspace
from app.repositories import records

router = APIRouter(prefix="/api/v1", tags=["Sandbox consent workflow"])
Scope = Annotated[Workspace, Depends(workspace, scope="function")]
Purpose = Literal["images", "reconstruction", "analysis", "sharing", "camera"]
FIELDS = """c.id,c.profile_id,c.purpose,c.status,c.created_at,c.accepted_at,c.expires_at,c.revoked_at,
 COALESCE(p.display_name,p.display_code) AS patient_name,
 CASE WHEN c.status='revoked' THEN 'revoked' WHEN c.status='pending' THEN 'pending'
 WHEN c.expires_at<=now() THEN 'expired' WHEN c.expires_at<=now()+interval '30 days' THEN 'expiring'
 ELSE 'active' END AS state"""


class Create(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profile_id: UUID
    purpose: Purpose


class Change(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["accept", "revoke"]
    confirmed: StrictBool


def writer(request):
    if request.state.sandbox_role not in ("administrator", "specialist"):
        raise DomainError(403, "FORBIDDEN", "No tienes permiso para modificar consentimientos.")


@router.get("/sandbox/consents")
def list_consents(scope: Scope):
    result = scope.connection.execute(
        text(f"""
            SELECT {FIELDS} FROM sandbox_consents c
            JOIN profiles p ON p.id=c.profile_id AND p.organization_id=c.organization_id
            WHERE c.organization_id=:org AND has_profile_access(c.profile_id)
            ORDER BY c.created_at DESC,c.id
        """),
        {"org": scope.organization_id},
    )
    return {"items": [dict(row) for row in result.mappings().all()]}


@router.post("/sandbox/consents", status_code=201)
def create_consent(data: Create, scope: Scope, request: Request):
    writer(request)
    records.profile(scope, data.profile_id, write=True)
    params = {
        "org": scope.organization_id,
        "profile": data.profile_id,
        "purpose": data.purpose,
        "actor": scope.actor_id,
        "id": uuid4(),
    }
    existing = scope.connection.execute(
        text("""
            SELECT id FROM sandbox_consents
            WHERE organization_id=:org AND profile_id=:profile AND purpose=:purpose
              AND (status='pending' OR (status='accepted' AND expires_at>now()))
        """),
        params,
    ).scalar()
    if existing:
        raise DomainError(
            409, "CONSENT_CONFLICT", "Ya existe una solicitud pendiente o vigente de este tipo."
        )
    scope.connection.execute(
        text(
            "INSERT INTO sandbox_consents(id,organization_id,profile_id,purpose,created_by) "
            "VALUES(:id,:org,:profile,:purpose,:actor)"
        ),
        params,
    )
    return {"id": params["id"]}


@router.patch("/sandbox/consents/{consent_id}")
def change_consent(consent_id: UUID, data: Change, scope: Scope, request: Request):
    writer(request)
    if not data.confirmed:
        raise DomainError(422, "CONFIRMATION_REQUIRED", "Se requiere confirmación expresa.")
    params = {"org": scope.organization_id, "id": consent_id, "actor": scope.actor_id}
    result = scope.connection.execute(
        text(
            "SELECT profile_id,status,expires_at FROM sandbox_consents "
            "WHERE organization_id=:org AND id=:id"
        ),
        params,
    )
    row = result.mappings().one_or_none()
    if not row:
        raise DomainError(404, "NOT_FOUND", "Consentimiento no disponible.")
    if data.action == "accept":
        records.profile(scope, row["profile_id"], write=True)
        statement = """
            UPDATE sandbox_consents SET status='accepted',accepted_at=now(),
              accepted_by=:actor,expires_at=now()+interval '365 days'
            WHERE organization_id=:org AND id=:id AND status='pending'
        """
    else:
        # Revocation remains possible for non-active profiles with an existing write grant.
        records.profile(scope, row["profile_id"])
        permitted = scope.connection.execute(
            text("SELECT has_profile_access(:profile,true)"), {"profile": row["profile_id"]}
        ).scalar_one()
        if not permitted:
            raise DomainError(403, "FORBIDDEN", "No tienes acceso de edición.")
        statement = """
            UPDATE sandbox_consents SET status='revoked',revoked_at=now(),revoked_by=:actor
            WHERE organization_id=:org AND id=:id AND status<>'revoked'
        """
    if scope.connection.execute(text(statement), params).rowcount != 1:
        raise DomainError(409, "CONSENT_CONFLICT", "El estado cambió. Actualiza la lista.")
    return {"id": consent_id}
