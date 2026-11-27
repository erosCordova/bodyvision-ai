from datetime import UTC, datetime
from time import perf_counter
from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.db.session import DEMO_SCHEMA_REVISION, SCHEMA_REVISION

router = APIRouter(prefix="/api/v1/health", tags=["Health"])


class LiveResponse(BaseModel):
    status: Literal["alive"] = "alive"
    service: str = "bodyvision-api"
    version: str = "0.2.0"
    phase: int = 2
    environment: str
    checked_at: datetime


class ReadyResponse(BaseModel):
    status: Literal["ready"] = "ready"
    database: Literal["connected"] = "connected"
    schema_revision: str
    database_latency_ms: float
    checked_at: datetime


@router.get("/live", response_model=LiveResponse)
def live(request: Request) -> LiveResponse:
    return LiveResponse(
        environment=request.app.state.settings.app_env, checked_at=datetime.now(UTC)
    )


@router.get("/ready", response_model=ReadyResponse, responses={503: {"description": "Not ready"}})
def ready(request: Request) -> ReadyResponse | JSONResponse:
    started = perf_counter()
    try:
        with request.app.state.engine.connect() as connection:
            revision = connection.execute(
                text("SELECT revision FROM system_schema_state WHERE singleton = true")
            ).scalar_one()
            expected_revision = (
                DEMO_SCHEMA_REVISION
                if request.app.state.settings.app_env in {"demo", "sandbox"}
                else SCHEMA_REVISION
            )
            if revision != expected_revision:
                raise ValueError("Schema mismatch")
    except (SQLAlchemyError, ValueError):
        return JSONResponse(
            status_code=503,
            content={
                "code": "NOT_READY",
                "message": "La base de datos o su versión de esquema no están disponibles.",
                "details": {},
                "correlation_id": request.state.correlation_id,
            },
        )
    return ReadyResponse(
        schema_revision=revision,
        database_latency_ms=round((perf_counter() - started) * 1000, 2),
        checked_at=datetime.now(UTC),
    )
