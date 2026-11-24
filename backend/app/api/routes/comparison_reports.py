"""Audited server PDF and CSV exports, restricted to authenticated fictional records."""

import base64
import hashlib
from datetime import date, datetime, time, timedelta
from itertools import chain
from typing import Annotated, Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, model_validator
from sqlalchemy import text

from app.api.deps import workspace
from app.core.errors import DomainError
from app.models.context import Workspace
from app.repositories import records
from app.services.comparison_pdf import comparison_pdf
from app.services.longitudinal_csv import (
    CsvSizeLimitError,
    CsvUnitMismatchError,
    build_longitudinal_csv,
)
from app.services.report_signatures import ReportReceipt, sign_report

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
    receipt: ReportReceipt | None = None


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
        text("SELECT audit_private_comparison_export(:event,:correlation,:profile,'pdf')"),
        {"event": report_id, "correlation": scope.correlation_id, "profile": profile_id},
    ).scalar_one()
    filename = f"bodyvision-{report_id}.pdf"
    receipt = (
        sign_report(
            settings.report_signing_key.get_secret_value(),
            format_name="pdf",
            export_id=report_id,
            filename=filename,
            generated_at=generated_at,
            content=pdf,
        )
        if settings.report_signing_key is not None
        else None
    )
    return ComparisonDownload(
        report_id=report_id,
        generated_at=generated_at,
        filename=filename,
        pdf_base64=base64.b64encode(pdf).decode("ascii"),
        sha256=hashlib.sha256(pdf).hexdigest(),
        receipt=receipt,
    )


class LongitudinalSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    metric_code: str
    period: Literal["30d", "90d", "1a", "all", "custom"] = "90d"
    start_date: str | None = None
    end_date: str | None = None

    @model_validator(mode="after")
    def validate_range(self) -> "LongitudinalSelection":
        if self.period != "custom":
            if self.start_date is not None or self.end_date is not None:
                raise ValueError("Las fechas requieren un periodo personalizado.")
            return self
        if self.start_date is None or self.end_date is None:
            raise ValueError("Selecciona las dos fechas del periodo.")
        start, end = date.fromisoformat(self.start_date), date.fromisoformat(self.end_date)
        today = datetime.now(ZoneInfo("America/Lima")).date()
        if (
            start.isoformat() != self.start_date
            or end.isoformat() != self.end_date
            or not date(1900, 1, 1) <= start <= end <= today
        ):
            raise ValueError("El intervalo de fechas no es válido.")
        return self


class LongitudinalDownload(BaseModel):
    export_id: UUID
    generated_at: datetime
    filename: str
    metric_code: str
    period: Literal["30d", "90d", "1a", "all", "custom"]
    start_date: str | None = None
    end_date: str | None = None
    row_count: int
    csv_base64: str
    sha256: str
    receipt: ReportReceipt | None = None


@router.post("/profiles/{profile_id}/reports/longitudinal", response_model=LongitudinalDownload)
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
    days = {"30d": 30, "90d": 90, "1a": 365, "all": None, "custom": None}[selection.period]
    start_at = end_at = None
    if selection.start_date is not None and selection.end_date is not None:
        lima = ZoneInfo("America/Lima")
        start_at = datetime.combine(date.fromisoformat(selection.start_date), time.min, lima)
        end_day = date.fromisoformat(selection.end_date) + timedelta(days=1)
        end_at = datetime.combine(end_day, time.min, lima)
    # One server cursor retains one SELECT snapshot across all fetch batches.
    # Rows are not materialized as a list; CSV bytes have a strict size budget.
    statement = text(
        """WITH export_clock AS MATERIALIZED (
               SELECT statement_timestamp() AS snapshot_at
           )
           SELECT m.id,m.metric_code,m.measured_at,m.value,m.unit,
                  m.method,m.outlier_confirmed,export_clock.snapshot_at
           FROM measurements m CROSS JOIN export_clock
           WHERE m.organization_id=:org AND m.profile_id=:profile
             AND m.metric_code=:metric AND m.is_current
             AND (CAST(:days AS integer) IS NULL OR
                  m.measured_at >= export_clock.snapshot_at -
                      make_interval(days => CAST(:days AS integer)))
             AND (CAST(:start_at AS timestamptz) IS NULL OR
                  m.measured_at >= CAST(:start_at AS timestamptz))
             AND (CAST(:end_at AS timestamptz) IS NULL OR
                  m.measured_at < CAST(:end_at AS timestamptz))
           ORDER BY m.measured_at,m.id"""
    )
    parameters = {
        "org": scope.organization_id,
        "profile": profile_id,
        "metric": selection.metric_code,
        "days": days,
        "start_at": start_at,
        "end_at": end_at,
    }
    try:
        with scope.connection.execute(
            statement.execution_options(yield_per=500), parameters
        ) as cursor:
            rows = cursor.mappings()
            first = next(rows, None)
            if first is None:
                raise DomainError(
                    422, "EMPTY_HISTORY", "No existen observaciones vigentes en el periodo."
                )
            generated_at = first["snapshot_at"]
            exported = build_longitudinal_csv(
                chain((first,), rows), selection.metric_code, metric["unit"]
            )
    except CsvSizeLimitError as exc:
        raise DomainError(
            422, "HISTORY_TOO_LARGE", "El CSV completo supera 8 MiB; selecciona un periodo menor."
        ) from exc
    except CsvUnitMismatchError as exc:
        raise DomainError(
            409, "INCONSISTENT_UNITS", "El historial contiene unidades distintas."
        ) from exc
    csv_bytes = exported.content
    report_id = uuid4()
    # The audit must commit before the response is delivered. It contains
    # neither report bytes nor their hash, and is not an external signature.
    scope.connection.execute(
        text("SELECT audit_private_comparison_export(:event,:correlation,:profile,'csv')"),
        {"event": report_id, "correlation": scope.correlation_id, "profile": profile_id},
    ).scalar_one()
    filename = f"bodyvision-historial-{report_id}.csv"
    receipt = (
        sign_report(
            settings.report_signing_key.get_secret_value(),
            format_name="csv",
            export_id=report_id,
            filename=filename,
            generated_at=generated_at,
            content=csv_bytes,
            row_count=exported.row_count,
        )
        if settings.report_signing_key is not None
        else None
    )
    return LongitudinalDownload(
        export_id=report_id,
        generated_at=generated_at,
        filename=filename,
        metric_code=selection.metric_code,
        period=selection.period,
        start_date=selection.start_date,
        end_date=selection.end_date,
        row_count=exported.row_count,
        csv_base64=base64.b64encode(csv_bytes).decode("ascii"),
        sha256=hashlib.sha256(csv_bytes).hexdigest(),
        receipt=receipt,
    )
