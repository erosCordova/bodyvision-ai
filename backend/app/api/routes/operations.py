"""Administrator-only diagnostics, scoped to the verified organization."""

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.errors import DomainError
from app.db.session import SCHEMA_REVISION
from app.services.auth_sessions import resolve_identity

router = APIRouter(prefix="/api/v1/auth", tags=["Private service operations"])


class RetentionStatus(BaseModel):
    state: Literal["ready", "failed", "pending", "overdue", "disabled"]
    checked_at: datetime | None


class DatabaseStatus(BaseModel):
    state: Literal["ready", "unavailable"]
    checked_at: datetime


class OperationsRead(BaseModel):
    scope: Literal["current_organization_current_process"]
    checked_at: datetime
    uptime_seconds: int
    window_seconds: int
    sample_limit: int
    sample_count: int
    successes: int
    client_errors: int
    server_errors: int
    query_interruptions: int
    p95_ms: float | None
    retention: RetentionStatus
    database: DatabaseStatus
    alerts: list[
        Literal[
            "server_failures",
            "query_interrupted",
            "slow_responses",
            "database_unavailable",
            "retention_failed",
            "retention_overdue",
        ]
    ]


@router.get("/operations", response_model=OperationsRead)
def operations(request: Request):
    identity = resolve_identity(request)
    if identity.role != "administrator":
        raise DomainError(403, "FORBIDDEN", "Solo un administrador puede consultar el servicio.")
    if request.headers.get("X-Workspace-ID"):
        raise DomainError(400, "UNTRUSTED_WORKSPACE", "No envíes un selector de organización.")
    result = request.app.state.operations.snapshot(identity.organization_id)
    state = "ready"
    try:
        with request.app.state.engine.connect() as connection:
            revision = connection.execute(
                text("SELECT revision FROM system_schema_state WHERE singleton=true")
            ).scalar_one()
            if revision != SCHEMA_REVISION:
                state = "unavailable"
    except SQLAlchemyError:
        state = "unavailable"
    result["database"] = {"state": state, "checked_at": datetime.now(UTC)}
    if state == "unavailable":
        result["alerts"].append("database_unavailable")
    return result
