import os
import re
from typing import Literal

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    app_env: Literal["local", "test", "demo", "staging", "production"] = "local"
    debug: bool = False
    database_url: SecretStr
    cors_origins: list[str] = ["http://localhost:8080"]
    allowed_hosts: list[str] = ["localhost", "127.0.0.1", "backend", "testserver"]

    @field_validator("database_url")
    @classmethod
    def postgres_only(cls, value: SecretStr) -> SecretStr:
        if not value.get_secret_value().startswith("postgresql+psycopg://"):
            raise ValueError("PostgreSQL with psycopg is required")
        return value

    @field_validator("cors_origins", "allowed_hosts")
    @classmethod
    def explicit_origins(cls, value: list[str]) -> list[str]:
        if not value or any("*" in entry for entry in value):
            raise ValueError("Explicit hosts and origins are required")
        return value

    @model_validator(mode="after")
    def block_unreleased_environments(self) -> "Settings":
        if self.app_env in {"staging", "production"}:
            raise ValueError(
                "F2 is synthetic local/test only. "
                "Identity, privacy, legal and operational gates are pending."
            )
        if self.app_env == "demo":
            hostname = os.environ.get("RENDER_EXTERNAL_HOSTNAME", "")
            if hostname and re.fullmatch(r"[a-zA-Z0-9.-]+", hostname):
                self.allowed_hosts = list(dict.fromkeys([*self.allowed_hosts, hostname]))
        if self.debug:
            raise ValueError("Debug mode is disabled")
        return self
