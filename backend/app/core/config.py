import os
import re
from typing import Literal

from cryptography.fernet import Fernet
from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    app_env: Literal["local", "test", "demo", "staging", "production"] = "local"
    debug: bool = False
    database_url: SecretStr
    cors_origins: list[str] = ["http://localhost:8080"]
    allowed_hosts: list[str] = ["localhost", "127.0.0.1", "backend", "testserver"]
    identity_enabled: bool = False
    auth_database_url: SecretStr | None = None
    mfa_enabled: bool = False
    mfa_encryption_key: SecretStr | None = None
    capture_encryption_key: SecretStr | None = None
    capture_decryption_keys: list[SecretStr] = []
    capture_retention_interval_seconds: int = 900

    @field_validator("database_url")
    @classmethod
    def postgres_only(cls, value: SecretStr) -> SecretStr:
        if not value.get_secret_value().startswith("postgresql+psycopg://"):
            raise ValueError("PostgreSQL with psycopg is required")
        return value

    @field_validator("auth_database_url")
    @classmethod
    def valid_auth_database_url(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and not value.get_secret_value().startswith("postgresql+psycopg://"):
            raise ValueError("A separate PostgreSQL auth role is required")
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
        if self.identity_enabled:
            if self.app_env not in {"local", "test"}:
                raise ValueError("Private authentication is local/test only")
            if self.auth_database_url is None:
                raise ValueError("AUTH_DATABASE_URL is required for private authentication")
            if self.auth_database_url.get_secret_value() == self.database_url.get_secret_value():
                raise ValueError("The authenticated database must use a distinct role")
        if self.mfa_enabled:
            if not self.identity_enabled or self.mfa_encryption_key is None:
                raise ValueError(
                    "MFA requires private authentication and an external encryption key"
                )
            try:
                Fernet(self.mfa_encryption_key.get_secret_value().encode("ascii"))
            except (ValueError, UnicodeError) as exc:
                raise ValueError("Invalid MFA encryption key") from exc
        if not 60 <= self.capture_retention_interval_seconds <= 86400:
            raise ValueError("Capture retention interval must be between 60 and 86400 seconds")
        if self.capture_decryption_keys and self.capture_encryption_key is None:
            raise ValueError("Previous capture keys require an active encryption key")
        if self.capture_encryption_key is not None:
            if not self.identity_enabled or self.app_env not in {"local", "test"}:
                raise ValueError("Synthetic capture encryption requires private local/test mode")
            try:
                Fernet(self.capture_encryption_key.get_secret_value().encode("ascii"))
            except (ValueError, UnicodeError) as exc:
                raise ValueError("Invalid synthetic capture encryption key") from exc
            active = self.capture_encryption_key.get_secret_value()
            if self.mfa_encryption_key and active == self.mfa_encryption_key.get_secret_value():
                raise ValueError("Capture encryption and MFA secrets must be distinct")
            seen = {active}
            for previous in self.capture_decryption_keys:
                raw = previous.get_secret_value()
                if raw in seen:
                    raise ValueError("Capture encryption keys must be unique")
                seen.add(raw)
                try:
                    Fernet(raw.encode("ascii"))
                except (ValueError, UnicodeError) as exc:
                    raise ValueError("Invalid previous capture decryption key") from exc
        if self.app_env == "demo":
            hostname = os.environ.get("RENDER_EXTERNAL_HOSTNAME", "")
            if hostname and re.fullmatch(r"[a-zA-Z0-9.-]+", hostname):
                self.allowed_hosts = list(dict.fromkeys([*self.allowed_hosts, hostname]))
        if self.debug:
            raise ValueError("Debug mode is disabled")
        return self
