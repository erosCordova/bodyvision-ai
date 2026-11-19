"""Private consent recording on synthetic records, never proof of legal consent."""

from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4

from fastapi import Request
from pydantic import BaseModel, ConfigDict, StrictBool, field_validator
from sqlalchemy import text

from app.core.errors import DomainError
from app.core.identity import Purpose, hash_session_token
from app.services.auth_sessions import bearer_token, resolve_identity


class ConsentAcceptance(BaseModel):
    model_config = ConfigDict(extra="forbid")
    purpose: Purpose
    version: Literal["bv-synthetic-v1"]
    confirmed: StrictBool

    @field_validator("confirmed")
    @classmethod
    def explicit_confirmation(cls, value: bool) -> bool:
        if value is not True:
            raise ValueError("Explicit synthetic consent confirmation is required")
        return value


class ConsentRead(BaseModel):
    id: UUID
    purpose: Purpose
    version: str
    cycle: int
    status: Literal["pending", "accepted", "revoked"]
    accepted_at: datetime | None
    revoked_at: datetime | None
    expires_at: datetime | None
    recorded_by: UUID
    revoked_by: UUID | None
    effective: bool


class ConsentHistory(BaseModel):
    items: list[ConsentRead]
    can_record: bool
    can_revoke: bool
    policy_version: Literal["bv-synthetic-v1"]
    checked_at: datetime


def consent_operation(
    request: Request,
    profile_id: UUID,
    operation: Literal["list", "accept", "revoke"],
    purpose: Purpose | None = None,
    consent_id: UUID | None = None,
) -> ConsentHistory:
    resolve_identity(request)
    if request.headers.get("X-Workspace-ID"):
        raise DomainError(400, "UNTRUSTED_WORKSPACE", "No envíes un selector de organización.")
    with request.app.state.auth_engine.begin() as connection:
        result = connection.execute(
            text(
                "SELECT private_profile_consents(CAST(:token AS char(64)),:profile,"
                ":operation,:purpose,:consent,:new_id,:event,:correlation)"
            ),
            {
                "token": hash_session_token(bearer_token(request)),
                "profile": profile_id,
                "operation": operation,
                "purpose": purpose,
                "consent": consent_id,
                "new_id": uuid4(),
                "event": uuid4(),
                "correlation": UUID(request.state.correlation_id),
            },
        ).scalar_one()
        error = result.get("error")
        if error == "not-found":
            raise DomainError(404, "NOT_FOUND", "Expediente no disponible.")
        if error == "forbidden":
            raise DomainError(403, "FORBIDDEN", "Se requiere permiso de edición del expediente.")
        if error == "conflict":
            raise DomainError(409, "CONSENT_CONFLICT", "El estado cambió. Actualiza el expediente.")
        return ConsentHistory.model_validate(result)
