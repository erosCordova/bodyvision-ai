from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from app.core.config import Settings

SCHEMA_REVISION = "0030_private_privacy_officer"
DEMO_SCHEMA_REVISION = "0002_data_core"


def build_engine(settings: Settings) -> Engine:
    return create_engine(
        settings.database_url.get_secret_value(),
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=5,
        connect_args={
            "connect_timeout": 3,
            "options": "-c statement_timeout=3000"
            + (" -c default_transaction_read_only=on" if settings.app_env == "demo" else ""),
        },
        hide_parameters=True,
    )
