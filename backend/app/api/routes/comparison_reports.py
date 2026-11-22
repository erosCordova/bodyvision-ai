"""Audited server PDF exports, restricted to authenticated fictional records."""

import base64
import hashlib
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text

from app.api.deps import workspace
from app.core.errors import DomainError
from app.models.context import Workspace
from app.repositories import records
from app.services.comparison_pdf import comparison_pdf
from app.services.longitudinal_csv import MAX_LONGITUDINAL_ROWS, render_longitudinal_csv

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


class LongitudinalSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    metric_code: str
    period: Literal["30d", "90d", "1a", "all"] = "90d"


class LongitudinalDownload(BaseModel):
    export_id: UUID
    generated_at: datetime
    filename: str
    metric_code: str
    period: Literal["30d", "90d", "1a", "all"]
    row_count: int
    csv_base64: str
    sha256: str


@router.post(
    "/profiles/{profile_id}/reports/longitudinal", response_model=LongitudinalDownload
)
def export_longitudinal(
    profile_id: UUID, selection: LongitudinalSelection, scope: Scope, request: Request
):
    settings = request.app.state.settings
    if not scope.authenticated or settings.app_env not in {"local", "test"}:
        raise DomainError(403, "REPORT_DISABLED", "Se requiere acceso privado de pruebas.")
    records.profile(scope, profile_id)
    if not scope.connection.execute(
        text("SELECT synthetic FROM organizations WHERE id=:org"),
        {"org": scope.organization_id},
    ).scalar_one():
        raise DomainError(403, "REPORT_DISABLED", "Solo se exportan expedientes ficticios.")
    metric = next(
        (item for item in records.metrics(scope) if item["code"] == selection.metric_code),
        None,
    )
    if metric is None:
        raise DomainError(422, "UNKNOWN_METRIC", "Selecciona una métrica autorizada.")
    days = {"30d": 30, "90d": 90, "1a": 365, "all": None}[selection.period]
    # Single bounded SQL statement, with current rows from one DB snapshot.
    statement = text(
        """SELECT m.id,m.metric_code,m.measured_at,m.value,m.unit,
                  m.method,m.outlier_confirmed,statement_timestamp() AS snapshot_at
           FROM measurements m
           WHERE m.organization_id=:org AND m.profile_id=:profile
             AND m.metric_code=:metric AND m.is_current
             AND (CAST(:days AS integer) IS NULL OR
                  m.measured_at >= statement_timestamp() -
                      make_interval(days => CAST(:days AS integer)))
           ORDER BY m.measured_at,m.id LIMIT :limit"""
    )
    parameters = {
        "org": scope.organization_id,
        "profile": profile_id,
        "metric": selection.metric_code,
        "days": days,
        "limit": MAX_LONGITUDINAL_ROWS + 1,
    }
    rows = [dict(row) for row in scope.connection.execute(statement, parameters).mappings()]
    if not rows:
        raise DomainError(422, "EMPTY_HISTORY", "No existen observaciones vigentes en el periodo.")
    if len(rows) > MAX_LONGITUDINAL_ROWS:
        raise DomainError(
            422,
            "HISTORY_TOO_LARGE",
            "Hay más de 500 registros; no se exportará un historial incompleto.",
        )
    if any(row["unit"] != metric["unit"] for row in rows):
        raise DomainError(409, "INCONSISTENT_UNITS", "El historial contiene unidades distintas.")
    csv_bytes = render_longitudinal_csv(rows, selection.metric_code, metric["unit"])
    report_id = uuid4()
    # The audit must commit before the response is delivered. It contains
    # neither report bytes nor their hash, and is not an external signature.
    scope.connection.execute(
        text("SELECT audit_private_comparison_export(:event,:correlation,:profile)"),
        {"event": report_id, "correlation": scope.correlation_id, "profile": profile_id},
    ).scalar_one()
    return LongitudinalDownload(
        export_id=report_id,
        generated_at=rows[0]["snapshot_at"],
        filename=f"bodyvision-historial-{report_id}.csv",
        metric_code=selection.metric_code,
        period=selection.period,
        row_count=len(rows),
        csv_base64=base64.b64encode(csv_bytes).decode("ascii"),
        sha256=hashlib.sha256(csv_bytes).hexdigest(),
    )
