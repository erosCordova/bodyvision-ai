"""Administrator-only diagnostics, scoped to the verified organization."""

from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.deps import workspace
from app.core.errors import DomainError
from app.db.session import SCHEMA_REVISION
from app.models.context import Workspace
from app.services.auth_sessions import resolve_identity

router = APIRouter(prefix="/api/v1/auth", tags=["Private service operations"])
Scope = Annotated[Workspace, Depends(workspace, scope="function")]
CAPTURE_INVENTORY_LIMIT = 1000


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


class CaptureRetentionInventory(BaseModel):
    scope: Literal["current_organization_accessible_profiles_only"]
    checked_at: datetime
    expired_count: int
    count_capped: bool
    display_limit: int
    oldest_expired_at: datetime | None
    purge_executed: Literal[False] = False


def describe_capture_retention(
    observed: int, oldest: datetime | None, checked: datetime
) -> CaptureRetentionInventory:
    """No tenant/profile IDs, ciphertext or unbounded totals in diagnostics."""
    if observed < 0 or observed > CAPTURE_INVENTORY_LIMIT + 1:
        raise ValueError("Invalid synthetic inventory sample size")
    return CaptureRetentionInventory(
        scope="current_organization_accessible_profiles_only",
        checked_at=checked,
        expired_count=min(observed, CAPTURE_INVENTORY_LIMIT),
        count_capped=observed > CAPTURE_INVENTORY_LIMIT,
        display_limit=CAPTURE_INVENTORY_LIMIT,
        oldest_expired_at=oldest if observed else None,
        purge_executed=False,
    )


@router.get("/captures/retention-inventory", response_model=CaptureRetentionInventory)
def capture_retention_inventory(request: Request, scope: Scope):
    """Read-only, RLS-scoped sample: NOT a global cleanup or backup inspection."""
    settings = request.app.state.settings
    if (
        not scope.authenticated
        or settings.app_env not in {"local", "test"}
        or settings.capture_encryption_key is None
    ):
        raise DomainError(403, "FORBIDDEN", "Archivo privado no habilitado.")
    if scope.role != "administrator":
        raise DomainError(403, "FORBIDDEN", "Solo un administrador de prueba.")
    # The data role's RLS only sees profiles granted to this actor. In
    # particular, zero does not mean that the entire organization is clean.
    # No ciphertext or per-file metadata are ever returned.
    statement = text(
        """WITH visible AS MATERIALIZED (
            SELECT expires_at,id FROM synthetic_capture_objects
            WHERE organization_id=:org AND expires_at<=statement_timestamp()
            ORDER BY expires_at,id LIMIT :limit
           )
           SELECT count(*)::integer AS observed,
                  min(expires_at) AS oldest,
                  statement_timestamp() AS checked
             FROM visible"""
    )
    row = (
        scope.connection.execute(
            statement,
            {"org": scope.organization_id, "limit": CAPTURE_INVENTORY_LIMIT + 1},
        )
        .mappings()
        .one()
    )
    return describe_capture_retention(row["observed"], row["oldest"], row["checked"])
