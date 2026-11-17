from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.db.session import SCHEMA_REVISION

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
    checked_at: datetime


@router.get("/live", response_model=LiveResponse)
def live(request: Request) -> LiveResponse:
    return LiveResponse(
        environment=request.app.state.settings.app_env, checked_at=datetime.now(UTC)
    )


@router.get("/ready", response_model=ReadyResponse, responses={503: {"description": "Not ready"}})
def ready(request: Request) -> ReadyResponse | JSONResponse:
    try:
        with request.app.state.engine.connect() as connection:
            revision = connection.execute(
                text("SELECT revision FROM system_schema_state WHERE singleton = true")
            ).scalar_one()
            if revision != SCHEMA_REVISION:
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
    return ReadyResponse(schema_revision=revision, checked_at=datetime.now(UTC))
