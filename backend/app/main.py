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
from app.api.routes.sandbox_auth import router as sandbox_router, check_sandbox_session, sandbox_event
from app.api.routes.sandbox_captures import router as sandbox_capture_router
from app.api.routes.sandbox_consents import router as sandbox_consent_router
from app.api.routes.comparison_reports import router as report_router
from app.api.routes.data_core import router as data_router
from app.api.routes.operations import router as operations_router
from app.api.routes.pose_summaries import router as pose_router
from app.api.routes.privacy_requests import router as privacy_router
from app.api.routes.server_pose import router as server_pose_router
from app.api.routes.simulation_scenarios import router as simulation_router
from app.api.routes.synthetic_captures import router as capture_router
from app.core.config import Settings
from app.core.errors import DomainError
from app.core.logging import configure_logging
from app.core.operations import OperationsMetrics
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
        if settings.app_env == "sandbox":
            from sqlalchemy import text
            with database_engine.connect() as connection:
                if not connection.execute(text("SELECT to_regclass('public.sandbox_sessions') IS NOT NULL")).scalar_one():
                    raise RuntimeError("Isolated sandbox schema is required")
        if settings.app_env == "sandbox":
            from app.services.b2_capture_migration import migrate_configured_account
            await asyncio.to_thread(migrate_configured_account,database_engine,settings)
        logging.getLogger("bodyvision").info("service_started")
        retention_task = None
        if (
            settings.identity_enabled
            and settings.capture_encryption_key is not None
            and settings.capture_retention_enabled
        ):
            retention_task = asyncio.create_task(
                retention_loop(
                    database_engine,
                    settings.capture_retention_interval_seconds,
                    application.state.operations,
                ),
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
        docs_url=None if settings.app_env in {"demo", "sandbox"} else "/api/v1/docs",
        redoc_url=None,
        openapi_url="/api/v1/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.engine = database_engine
    app.state.auth_engine = auth_engine
    app.state.operations = OperationsMetrics(
        retention_enabled=bool(
            settings.identity_enabled
            and settings.capture_encryption_key
            and settings.capture_retention_enabled
        ),
        retention_interval=settings.capture_retention_interval_seconds,
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)

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
        response = JSONResponse(
            status_code=exc.status,
            content={
                "code": exc.code,
                "message": exc.message,
                "details": exc.details,
                "correlation_id": request.state.correlation_id,
            },
        )
        for name, path in exc.clear_cookies:
            response.delete_cookie(key=name, path=path, samesite="strict")
        return response

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
            elif settings.app_env == "sandbox" and request.url.path.startswith("/api/"):
                path = request.url.path
                if request.method == "OPTIONS" or path in {"/api/v1/health/live", "/api/v1/health/ready", "/api/v1/auth/login"}:
                    response = await call_next(request)
                else:
                    try:
                        check_sandbox_session(request)
                    except DomainError as exc:
                        response = error(request, exc.status, exc.code, exc.message)
                    else:
                        role = request.state.sandbox_role
                        if role == "privacy_officer" and not path.startswith("/api/v1/auth/"):
                            response = error(request, 403, "FORBIDDEN", "Tu rol no permite consultar expedientes.")
                        elif role == "member" and request.method not in {"GET", "HEAD", "OPTIONS"} and not path.startswith("/api/v1/auth/"):
                            response = error(request, 403, "FORBIDDEN", "Tu rol solo permite consultar registros.")
                        elif request.method not in {"GET", "HEAD", "OPTIONS"} and not (
                            path in {"/api/v1/auth/logout", "/api/v1/auth/activity", "/api/v1/auth/admin/users", "/api/v1/profiles"}
                            or __import__("re").fullmatch(r"/api/v1/profiles/[0-9a-fA-F-]{36}(?:/archive|/measurements)?", path)
                            or __import__("re").fullmatch(r"/api/v1/measurements/[0-9a-fA-F-]{36}", path)
                            or __import__("re").fullmatch(r"/api/v1/profiles/[0-9a-fA-F-]{36}/captures(?:/[0-9a-fA-F-]{36})?", path)
                            or (request.method == "POST" and path == "/api/v1/sandbox/consents")
                            or (request.method == "PATCH" and __import__("re").fullmatch(r"/api/v1/sandbox/consents/[0-9a-fA-F-]{36}", path))
                        ):
                            response = error(request, 403, "SANDBOX_LIMIT", "Operación no habilitada en pruebas.")
                        else:
                            response = await call_next(request)
                            if request.method not in {"GET", "HEAD", "OPTIONS"} and not path.startswith("/api/v1/auth/"):
                                route = request.scope.get("route")
                                sandbox_event(request, route.path if route else "unmatched", response.status_code)
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
            request.state.operations_query_interrupted = (
                getattr(original, "sqlstate", None) == "57014"
            )
            response = error(request, 500, "INTERNAL_ERROR", "No se pudo completar la operación.")
        response.headers["X-Correlation-ID"] = correlation_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        route = request.scope.get("route")
        organization = getattr(request.state, "operations_organization", None)
        if organization is not None and route and route.path != "/api/v1/auth/operations":
            app.state.operations.observe(
                organization,
                response.status_code,
                (time.perf_counter() - started) * 1000,
                interrupted=getattr(request.state, "operations_query_interrupted", False),
            )
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

    # CORS must wrap request_context so authorization errors also reach the browser.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(dict.fromkeys([*settings.cors_origins, *(["https://bodyvision-ai-redesign.onrender.com"] if settings.app_env == "sandbox" else [])])),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=[
            "X-Correlation-ID",
            "Content-Type",
            "X-Workspace-ID",
            "Idempotency-Key",
            "X-Synthetic-Only",
            *(["Authorization"] if settings.identity_enabled or settings.app_env == "sandbox" else []),
            *(["X-Requested-With"] if settings.jwt_access_enabled else []),
        ],
        expose_headers=["X-Correlation-ID"],
    )

    app.include_router(health_router)
    app.include_router(data_router)
    app.include_router(report_router)
    app.include_router(simulation_router)
    if settings.app_env == "sandbox":
        app.include_router(sandbox_router)
        app.include_router(sandbox_capture_router)
        app.include_router(sandbox_consent_router)
    if settings.identity_enabled:
        app.include_router(auth_router)
        app.include_router(operations_router)
        app.include_router(pose_router)
        app.include_router(server_pose_router)
        app.include_router(capture_router)
        app.include_router(privacy_router)
    return app
