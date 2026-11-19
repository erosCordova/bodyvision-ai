import asyncio
import logging
import time
from contextlib import asynccontextmanager, suppress
from uuid import UUID, uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.health import router as health_router
from app.api.routes.auth import router as auth_router
from app.api.routes.data_core import router as data_router
from app.api.routes.simulation_scenarios import router as simulation_router
from app.api.routes.synthetic_captures import router as capture_router
from app.core.config import Settings
from app.core.errors import DomainError
from app.core.logging import configure_logging
from app.db.session import build_engine
from app.workers.capture_retention import retention_loop


def create_app(settings: Settings | None = None, engine: Engine | None = None) -> FastAPI:
    settings = settings or Settings()
    configure_logging()
    database_engine = engine if engine is not None else build_engine(settings)
    auth_engine = (
        create_engine(
            settings.auth_database_url.get_secret_value(),
            pool_pre_ping=True,
            hide_parameters=True,
            connect_args={"connect_timeout": 3, "options": "-c statement_timeout=3000"},
        )
        if settings.identity_enabled and settings.auth_database_url is not None
        else None
    )

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        logging.getLogger("bodyvision").info("service_started")
        retention_task = None
        if settings.identity_enabled and settings.capture_encryption_key is not None:
            retention_task = asyncio.create_task(
                retention_loop(database_engine, settings.capture_retention_interval_seconds),
                name="private_synthetic_capture_retention",
            )
        try:
            yield
        finally:
            if retention_task is not None:
                retention_task.cancel()
                with suppress(asyncio.CancelledError):
                    await retention_task
            database_engine.dispose()
            if auth_engine is not None:
                auth_engine.dispose()
            logging.getLogger("bodyvision").info("service_stopped")

    app = FastAPI(
        title="BODYVISION AI — Synthetic data core",
        version="0.2.0",
        description="Fase 2. Núcleo de datos ficticios local; identidad y uso real aún bloqueados.",
        docs_url=None if settings.app_env == "demo" else "/api/v1/docs",
        redoc_url=None,
        openapi_url="/api/v1/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.engine = database_engine
    app.state.auth_engine = auth_engine
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=[
            "X-Correlation-ID",
            "Content-Type",
            "X-Workspace-ID",
            "Idempotency-Key",
            "X-Synthetic-Only",
            *(["Authorization"] if settings.identity_enabled else []),
        ],
        expose_headers=["X-Correlation-ID"],
    )

    def error(request: Request, status: int, code: str, message: str) -> JSONResponse:
        return JSONResponse(
            status_code=status,
            content={
                "code": code,
                "message": message,
                "details": {},
                "correlation_id": request.state.correlation_id,
            },
        )

    @app.exception_handler(DomainError)
    async def domain_error(request: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status,
            content={
                "code": exc.code,
                "message": exc.message,
                "details": exc.details,
                "correlation_id": request.state.correlation_id,
            },
        )

    @app.exception_handler(IntegrityError)
    async def integrity_error(request: Request, exc: IntegrityError) -> JSONResponse:
        return error(
            request,
            409,
            "CONFLICT",
            "El registro cambió o incumple una restricción. Actualiza y revisa los datos.",
        )

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        code = "NOT_FOUND" if exc.status_code == 404 else "HTTP_ERROR"
        return error(request, exc.status_code, code, "Recurso no disponible.")

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        return error(request, 422, "UNPROCESSABLE_ENTITY", "Revisa los datos enviados.")

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        started = time.perf_counter()
        try:
            correlation_id = str(UUID(request.headers.get("X-Correlation-ID", "")))
        except ValueError:
            correlation_id = str(uuid4())
        request.state.correlation_id = correlation_id
        try:
            if settings.app_env == "demo" and request.method not in {"GET", "HEAD", "OPTIONS"}:
                response = error(
                    request,
                    403,
                    "DEMO_READ_ONLY",
                    "La demostración pública es de solo lectura y usa datos ficticios.",
                )
            else:
                response = await call_next(request)
        except Exception as exc:
            # Never log exception messages: drivers can include credentials/URLs.
            # SQLSTATE and error class are enough for safe production triage.
            original = getattr(exc, "orig", exc)
            logging.getLogger("bodyvision").error(
                "unhandled_request_error",
                extra={
                    "error_type": type(exc).__name__,
                    "driver_error_type": type(original).__name__,
                    "sqlstate": getattr(original, "sqlstate", None),
                },
            )
            response = error(request, 500, "INTERNAL_ERROR", "No se pudo completar la operación.")
        response.headers["X-Correlation-ID"] = correlation_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        route = request.scope.get("route")
        logging.getLogger("bodyvision").info(
            "request_completed",
            extra={
                "correlation_id": correlation_id,
                "method": request.method,
                "route": route.path if route else "unmatched",
                "status_code": response.status_code,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            },
        )
        return response

    app.include_router(health_router)
    app.include_router(data_router)
    app.include_router(simulation_router)
    if settings.identity_enabled:
        app.include_router(auth_router)
        app.include_router(capture_router)
    return app
