"""Audited server PDF exports, restricted to authenticated fictional records."""

import base64
import hashlib
from datetime import datetime
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text

from app.api.deps import workspace
from app.core.errors import DomainError
from app.models.context import Workspace
from app.repositories import records
from app.services.comparison_pdf import comparison_pdf

router = APIRouter(prefix="/api/v1", tags=["Private fictional comparison reports"])
Scope = Annotated[Workspace, Depends(workspace, scope="function")]


class ComparisonSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    initial_id: UUID
    final_id: UUID


class ComparisonDownload(BaseModel):
    report_id: UUID
    generated_at: datetime
    filename: str
    pdf_base64: str
    sha256: str


@router.post("/profiles/{profile_id}/reports/comparison", response_model=ComparisonDownload)
def export_comparison(
    profile_id: UUID, selection: ComparisonSelection, scope: Scope, request: Request
):
    settings = request.app.state.settings
    if not scope.authenticated or settings.app_env not in {"local", "test"}:
        raise DomainError(403, "REPORT_DISABLED", "Se requiere acceso privado de pruebas.")
    profile = records.profile(scope, profile_id)
    if not scope.connection.execute(
        text("SELECT synthetic FROM organizations WHERE id=:org"),
        {"org": scope.organization_id},
    ).scalar_one():
        raise DomainError(403, "REPORT_DISABLED", "Solo se exportan expedientes ficticios.")
    if selection.initial_id == selection.final_id:
        raise DomainError(422, "INVALID_COMPARISON", "Selecciona dos mediciones distintas.")
    # One statement reads both immutable values and their current status from
    # the same snapshot, including for users with read-only grants.
    rows = {
        row["id"]: dict(row)
        for row in scope.connection.execute(
            text("""SELECT m.*,statement_timestamp() AS snapshot_at FROM measurements m
                WHERE m.organization_id=:org AND m.profile_id=:profile
                  AND m.id = ANY(:ids)"""),
            {
                "org": scope.organization_id,
                "profile": profile_id,
                "ids": [selection.initial_id, selection.final_id],
            },
        ).mappings()
    }
    if len(rows) != 2:
        raise DomainError(404, "NOT_FOUND", "Medición no disponible.")
    initial, final = rows[selection.initial_id], rows[selection.final_id]
    if (
        not all(row["is_current"] for row in rows.values())
        or initial["metric_code"] != final["metric_code"]
        or initial["unit"] != final["unit"]
        or initial["measured_at"] >= final["measured_at"]
    ):
        raise DomainError(409, "STALE_COMPARISON", "Actualiza las mediciones y revisa las fechas.")
    metric = next(m for m in records.metrics(scope) if m["code"] == initial["metric_code"])
    report_id, generated_at = uuid4(), initial["snapshot_at"]
    pdf = comparison_pdf(
        report_id=str(report_id),
        profile_code=profile["display_code"],
        metric_label=metric["label"],
        unit=metric["unit"],
        generated_at=generated_at,
        initial=initial,
        final=final,
    )
    # The dependency commits before returning the response; audit failure blocks delivery.
    scope.connection.execute(
        text("SELECT audit_private_comparison_export(:event,:correlation,:profile)"),
        {"event": report_id, "correlation": scope.correlation_id, "profile": profile_id},
    ).scalar_one()
    return ComparisonDownload(
        report_id=report_id,
        generated_at=generated_at,
        filename=f"bodyvision-{report_id}.pdf",
        pdf_base64=base64.b64encode(pdf).decode("ascii"),
        sha256=hashlib.sha256(pdf).hexdigest(),
    )
