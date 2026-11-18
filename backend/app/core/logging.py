import json
import logging
import sys
from datetime import UTC, datetime


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        # Explicit allowlist. Never format exception text, request URLs, bodies or headers.
        payload = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "event": record.getMessage(),
        }
        for name in ("correlation_id", "method", "route", "status_code", "duration_ms", "error_type", "driver_error_type", "sqlstate"):
            if hasattr(record, name):
                payload[name] = getattr(record, name)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger("bodyvision")
    logger.handlers = [handler]
    logger.setLevel(logging.INFO)
    logger.propagate = False
