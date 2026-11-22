"""Strict, short-lived HS256 access JWTs for the opt-in synthetic identity API.

No JWT is accepted merely because its signature is valid: the API must also
resolve its session digest in PostgreSQL on every authenticated request.
"""

import base64
import hashlib
import hmac
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from app.core.identity import Identity, Role

ACCESS_ISSUER = "bodyvision-ai-private"
ACCESS_AUDIENCE = "bodyvision-private-api"
ACCESS_LIFETIME = timedelta(minutes=15)
_ACCESS_HEADER = b'{"alg":"HS256","typ":"JWT"}'
_SESSION_DIGEST = re.compile(r"[0-9a-f]{64}")
_BASE64URL = re.compile(r"[A-Za-z0-9_-]+")
_SIGNING_KEY_FORMAT = re.compile(r"[A-Za-z0-9_-]{42}[AQgw]")
_ACCESS_FIELDS = {"iss", "aud", "sub", "org", "role", "sid", "iat", "nbf", "exp", "jti"}


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _decode(value: str) -> bytes:
    if not isinstance(value, str) or _BASE64URL.fullmatch(value) is None:
        raise ValueError("Invalid JWT encoding")
    decoded = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    if _encode(decoded) != value:
        raise ValueError("Noncanonical JWT encoding")
    return decoded


def decode_signing_key(encoded: str) -> bytes:
    """Only accept 256-bit, canonical base64url secrets supplied externally."""
    if not isinstance(encoded, str) or _SIGNING_KEY_FORMAT.fullmatch(encoded) is None:
        raise ValueError("Expected a 256-bit base64url signing key")
    secret = _decode(encoded)
    if len(secret) != 32:
        raise ValueError("Invalid signing key")
    return secret


@dataclass(frozen=True)
class AccessClaims:
    organization_id: UUID
    user_id: UUID
    role: Role
    session_digest: str
    expires_at: datetime


def issue_access_token(
    signing_key: bytes,
    identity: Identity,
    session_digest: str,
    session_expires_at: datetime,
    *,
    now: datetime | None = None,
) -> tuple[str, datetime]:
    if not isinstance(signing_key, bytes) or len(signing_key) != 32:
        raise ValueError("Invalid JWT signing key")
    if _SESSION_DIGEST.fullmatch(session_digest) is None:
        raise ValueError("Invalid authenticated session digest")
    if not identity.active or identity.role not in {"administrator", "specialist", "member"}:
        raise ValueError("Inactive identity")
    timestamp = now or datetime.now(UTC)
    if timestamp.tzinfo is None or session_expires_at.tzinfo is None:
        raise ValueError("Timezone-aware timestamps are required")
    issued = int(timestamp.timestamp())
    expiration = min(
        issued + int(ACCESS_LIFETIME.total_seconds()),
        int(session_expires_at.timestamp()),
    )
    if expiration <= issued:
        raise ValueError("Session requires reauthentication")
    payload = {
        "iss": ACCESS_ISSUER,
        "aud": ACCESS_AUDIENCE,
        "sub": str(identity.user_id),
        "org": str(identity.organization_id),
        "role": identity.role,
        "sid": session_digest,
        "iat": issued,
        "nbf": issued,
        "exp": expiration,
        "jti": str(uuid4()),
    }
    body = _encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = (_encode(_ACCESS_HEADER) + "." + body).encode("ascii")
    signature = _encode(hmac.new(signing_key, signing_input, hashlib.sha256).digest())
    return signing_input.decode("ascii") + "." + signature, datetime.fromtimestamp(
        expiration, UTC
    )


def _unique_object(items: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in items:
        if key in result:
            raise ValueError("Duplicate JWT claim")
        result[key] = value
    return result


def verify_access_token(
    encoded: str, signing_key: bytes, *, now: datetime | None = None
) -> AccessClaims:
    """Strictly reject JWT confusion, malformed claims and expired tokens."""
    if not isinstance(signing_key, bytes) or len(signing_key) != 32:
        raise ValueError("Invalid JWT signing key")
    if not isinstance(encoded, str) or len(encoded) > 4096:
        raise ValueError("Invalid access JWT")
    parts = encoded.split(".")
    if len(parts) != 3 or parts[0] != _encode(_ACCESS_HEADER):
        raise ValueError("Unsupported JWT header")
    signing_input = (parts[0] + "." + parts[1]).encode("ascii")
    expected = hmac.new(signing_key, signing_input, hashlib.sha256).digest()
    try:
        signature = _decode(parts[2])
        if not hmac.compare_digest(signature, expected):
            raise ValueError("Invalid JWT signature")
        payload = json.loads(_decode(parts[1]), object_pairs_hook=_unique_object)
        if not isinstance(payload, dict) or set(payload) != _ACCESS_FIELDS:
            raise ValueError("Invalid access claims")
        if payload["iss"] != ACCESS_ISSUER or payload["aud"] != ACCESS_AUDIENCE:
            raise ValueError("Invalid JWT issuer or audience")
        if payload["role"] not in {"administrator", "specialist", "member"}:
            raise ValueError("Invalid JWT role")
        sid = payload["sid"]
        if not isinstance(sid, str) or _SESSION_DIGEST.fullmatch(sid) is None:
            raise ValueError("Invalid JWT session binding")
        for field in ("iat", "nbf", "exp"):
            if type(payload[field]) is not int:
                raise ValueError("Invalid JWT time claim")
        issued, not_before, expiration = (
            payload["iat"],
            payload["nbf"],
            payload["exp"],
        )
        timestamp = now or datetime.now(UTC)
        if timestamp.tzinfo is None:
            raise ValueError("Invalid verifier clock")
        clock = int(timestamp.timestamp())
        if (
            not_before != issued
            or issued > clock + 30
            or not_before > clock
            or expiration <= clock
            or expiration <= issued
            or expiration - issued > int(ACCESS_LIFETIME.total_seconds())
        ):
            raise ValueError("JWT outside its lifetime")
        if UUID(payload["jti"]).version != 4:
            raise ValueError("Invalid JWT identifier")
        return AccessClaims(
            organization_id=UUID(payload["org"]),
            user_id=UUID(payload["sub"]),
            role=payload["role"],
            session_digest=sid,
            expires_at=datetime.fromtimestamp(expiration, UTC),
        )
    except (TypeError, UnicodeError, ValueError, OverflowError) as exc:
        raise ValueError("Invalid access JWT") from exc
