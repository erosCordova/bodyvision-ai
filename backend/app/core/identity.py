"""Identity primitives for the next secure API iteration.

These functions do not authenticate the existing synthetic workspace selector.
No login endpoint is exposed until protected endpoints and provisioning are
ready. Never log passwords, session tokens, or personal information.
"""

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

PBKDF2_ITERATIONS = 600_000
PASSWORD_MIN_LENGTH = 12
PASSWORD_MAX_LENGTH = 128
SESSION_TOKEN_BYTES = 32
Role = Literal["administrator", "specialist", "member"]
Purpose = Literal["capture", "pose", "report", "storage"]
Action = Literal[
    "admin:manage",
    "profile:read",
    "profile:write",
    "capture:create",
    "pose:run",
    "report:read",
]


def hash_password(password: str, *, salt: bytes | None = None) -> str:
    """PBKDF2-HMAC-SHA256 with a random 128-bit salt; never persist plaintext."""
    if not PASSWORD_MIN_LENGTH <= len(password) <= PASSWORD_MAX_LENGTH:
        raise ValueError("Password length is outside the permitted range")
    if salt is None:
        salt = secrets.token_bytes(16)
    if len(salt) != 16:
        raise ValueError("Invalid salt")
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Fail closed for all malformed or outdated password verifiers."""
    try:
        algorithm, count, salt_hex, digest_hex = stored.split("$")
        if algorithm != "pbkdf2_sha256" or int(count) != PBKDF2_ITERATIONS:
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
        if len(salt) != 16 or len(expected) != 32 or len(password) > PASSWORD_MAX_LENGTH:
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
        return hmac.compare_digest(digest, expected)
    except (ValueError, TypeError, AttributeError, UnicodeError):
        return False


def login_bucket_digest(organization_id: UUID, email: str) -> str:
    """Pseudonymous, organization-scoped key: never store raw login email."""
    normalized = email.strip().lower()
    return hashlib.sha256(organization_id.bytes + b":" + normalized.encode("utf-8")).hexdigest()


def issue_session_token() -> tuple[str, str]:
    """Return an opaque bearer token and its digest; persist only the digest."""
    token = secrets.token_urlsafe(SESSION_TOKEN_BYTES)
    return token, hash_session_token(token)


def hash_session_token(token: str) -> str:
    if not isinstance(token, str) or not (40 <= len(token) <= 256):
        raise ValueError("Invalid session token")
    try:
        return hashlib.sha256(token.encode("ascii")).hexdigest()
    except UnicodeError as exc:
        raise ValueError("Invalid session token") from exc


@dataclass(frozen=True)
class Identity:
    organization_id: UUID
    user_id: UUID
    role: Role
    active: bool


@dataclass(frozen=True)
class ConsentState:
    purpose: Purpose
    accepted_at: datetime | None
    revoked_at: datetime | None = None
    expires_at: datetime | None = None
    version: str = ""
    status: Literal["pending", "accepted", "revoked"] = "pending"


def valid_consent(consent: ConsentState | None, purpose: Purpose, at: datetime) -> bool:
    if (
        consent is None
        or consent.purpose != purpose
        or consent.status != "accepted"
        or not consent.version.strip()
        or consent.accepted_at is None
    ):
        return False
    if at.tzinfo is None or consent.accepted_at.tzinfo is None:
        return False
    if consent.accepted_at > at or consent.revoked_at is not None:
        return False
    return consent.expires_at is None or (
        consent.expires_at.tzinfo is not None and consent.expires_at > at
    )


def authorized(
    identity: Identity | None,
    organization_id: UUID,
    action: Action,
    *,
    access_level: Literal["read", "write", "manage"] | None = None,
    consent: ConsentState | None = None,
    at: datetime | None = None,
) -> bool:
    """Deny by default, including administrators reading patient records.

    An administrator manages platform resources, but still requires an
    explicit profile grant to read or modify individual records.
    """
    if identity is None or not identity.active or identity.organization_id != organization_id:
        return False
    if identity.role not in {"administrator", "specialist", "member"}:
        return False
    if action == "admin:manage":
        return identity.role == "administrator"
    if action not in {
        "profile:read",
        "profile:write",
        "capture:create",
        "pose:run",
        "report:read",
    }:
        return False
    if access_level is None:
        return False
    if identity.role == "member" and action in {"profile:write", "capture:create", "pose:run"}:
        return False
    if action in {"profile:write", "capture:create", "pose:run"}:
        if access_level not in {"write", "manage"}:
            return False
    elif access_level not in {"read", "write", "manage"}:
        return False
    consent_required: dict[Action, Purpose] = {
        "capture:create": "capture",
        "pose:run": "pose",
        "report:read": "report",
    }
    purpose = consent_required.get(action)
    if purpose is None:
        return True
    return valid_consent(consent, purpose, at or datetime.now(UTC))
