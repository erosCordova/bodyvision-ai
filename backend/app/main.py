import logging
import time
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.engine import Engine
from starlette.exceptions import HTTPException
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.health import router as health_router
from app.core.config import Settings
from app.core.logging import configure_logging
from app.db.session import build_engine


def create_app(settings: Settings | None = None, engine: Engine | None = None) -> FastAPI:
    settings = settings or Settings()
    configure_logging()
    database_engine = engine if engine is not None else build_engine(settings)

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        logging.getLogger("bodyvision").info("service_started")
        yield
        database_engine.dispose()
        logging.getLogger("bodyvision").info("service_stopped")

    app = FastAPI(
        title="BODYVISION AI — Foundation",
        version="0.1.0",
        description="Fase 1. Solo infraestructura local; sin datos personales ni flujos clínicos.",
        docs_url="/api/v1/docs",
        redoc_url=None,
        openapi_url="/api/v1/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.engine = database_engine
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["X-Correlation-ID", "Content-Type"],
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
            response = await call_next(request)
        except Exception:
            # Do not expose or log exception strings: database URLs may contain credentials.
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
    return app
