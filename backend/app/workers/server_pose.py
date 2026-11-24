"""Opt-in local/test worker; it never receives production or auth-owner credentials."""

import hashlib
import logging
import os
import time
from pathlib import Path
from subprocess import TimeoutExpired
from uuid import uuid4

from cryptography.fernet import InvalidToken
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from app.core.config import Settings
from app.core.errors import DomainError
from app.services.capture_crypto import CaptureCipher
from app.services.server_pose_inference import run_inference

logger = logging.getLogger("bodyvision")


def run_once(engine: Engine, cipher: CaptureCipher, model: Path) -> bool:
    token = uuid4()
    with engine.begin() as conn:
        conn.execute(text("SET LOCAL ROLE bodyvision_pose_worker"))
        job = conn.execute(
            text("SELECT job_id FROM claim_server_pose(:token)"), {"token": token}
        ).scalar_one_or_none()
    if job is None:
        return False
    params = {"id": job, "token": token}
    # Consent and capture locks acquired by read_server_pose are retained
    # until completion. The claim token prevents an old worker from finishing.
    with engine.begin() as conn:
        conn.execute(text("SET LOCAL ROLE bodyvision_pose_worker"))
        row = (
            conn.execute(text("SELECT * FROM read_server_pose(:id,:token)"), params)
            .mappings()
            .one_or_none()
        )
        output = None
        problem = None
        if row is None:
            problem = "CONSENT_REQUIRED"
        else:
            try:
                payload = cipher.decrypt(bytes(row["ciphertext"]))
                if hashlib.sha256(payload).hexdigest() != row["sha256_digest"]:
                    raise ValueError("Capture checksum mismatch")
            except (InvalidToken, ValueError):
                problem = "CAPTURE_INVALID"
            else:
                try:
                    output = run_inference(payload, model).model_dump_json()
                except DomainError:
                    problem = "CAPTURE_INVALID"
                except (FileNotFoundError, PermissionError, ValueError):
                    problem = "MODEL_UNAVAILABLE"
                except TimeoutExpired:
                    problem = "TIMEOUT"
                except Exception:
                    problem = "INFERENCE_FAILED"
        conn.execute(
            text("SELECT finish_server_pose(:id,:token,CAST(:output AS jsonb),:problem)"),
            {**params, "output": output, "problem": problem},
        ).scalar_one()
    return True


def main() -> None:
    settings = Settings()
    url = os.environ.get("POSE_WORKER_DATABASE_URL", "")
    model = os.environ.get("POSE_WORKER_MODEL_PATH", "")
    if (
        settings.app_env not in {"local", "test"}
        or not settings.identity_enabled
        or not settings.capture_encryption_key
        or not url.startswith("postgresql+psycopg://")
        or not model
        or url == settings.database_url.get_secret_value()
        or (
            settings.auth_database_url is not None
            and url == settings.auth_database_url.get_secret_value()
        )
    ):
        raise SystemExit("Dedicated synthetic worker settings required")
    engine = create_engine(url, pool_pre_ping=True, hide_parameters=True)
    try:
        with engine.begin() as conn:
            privileged = conn.execute(
                text("""SELECT rolsuper OR rolcreaterole OR rolbypassrls OR rolcreatedb
                    FROM pg_roles WHERE rolname=session_user""")
            ).scalar_one()
            if privileged:
                raise SystemExit("Worker login cannot have elevated database privileges")
        cipher = CaptureCipher.from_settings(settings)
        while True:
            try:
                worked = run_once(engine, cipher, Path(model))
            except Exception as exc:
                logger.error("server_pose_worker_error", extra={"error_type": type(exc).__name__})
                worked = False
            if not worked:
                time.sleep(2)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
