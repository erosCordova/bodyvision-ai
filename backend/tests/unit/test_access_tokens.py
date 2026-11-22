"""JWT signature and claim regression cases; never use a live account."""

import base64
import hashlib
import hmac
import json
import secrets
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from pydantic import SecretStr, ValidationError

from app.core.access_tokens import (
    decode_signing_key,
    issue_access_token,
    verify_access_token,
)
from app.core.config import Settings
from app.core.identity import Identity

KEY = bytes(range(32))
CLOCK = datetime(2026, 11, 21, 12, 0, tzinfo=UTC)
SESSION_DIGEST = "f" * 64


def _identity():
    return Identity(uuid4(), uuid4(), "specialist", True)


def _token():
    return issue_access_token(
        KEY, _identity(), SESSION_DIGEST, CLOCK + timedelta(hours=8), now=CLOCK
    )[0]


def _encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _forge(payload: dict, key: bytes = KEY) -> str:
    header = _encode(b'{"alg":"HS256","typ":"JWT"}')
    body = _encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    message = header + "." + body
    signature = _encode(hmac.new(key, message.encode("ascii"), hashlib.sha256).digest())
    return message + "." + signature


def test_signed_access_jwt_round_trip_and_15_minute_limit():
    identity = _identity()
    token, expiration = issue_access_token(
        KEY, identity, SESSION_DIGEST, CLOCK + timedelta(hours=8), now=CLOCK
    )
    assert len(token.split(".")) == 3
    assert expiration == CLOCK + timedelta(minutes=15)
    claims = verify_access_token(token, KEY, now=CLOCK)
    assert claims.organization_id == identity.organization_id
    assert claims.user_id == identity.user_id
    assert claims.role == "specialist"
    assert claims.session_digest == SESSION_DIGEST
    assert claims.expires_at == expiration
    assert SESSION_DIGEST not in token
    with pytest.raises(ValueError):
        verify_access_token(token, KEY, now=expiration)


def test_jwt_never_outlives_its_database_session():
    identity = _identity()
    token, expiration = issue_access_token(
        KEY, identity, SESSION_DIGEST, CLOCK + timedelta(seconds=45), now=CLOCK
    )
    assert expiration == CLOCK + timedelta(seconds=45)
    assert verify_access_token(token, KEY, now=CLOCK).expires_at == expiration
    with pytest.raises(ValueError):
        issue_access_token(KEY, identity, SESSION_DIGEST, CLOCK, now=CLOCK)
    with pytest.raises(ValueError):
        issue_access_token(KEY, identity, SESSION_DIGEST, CLOCK, now=CLOCK.replace(tzinfo=None))


@pytest.mark.parametrize(
    "mutate",
    [
        lambda t: t.replace(".", "=", 1),
        lambda t: "Bearer " + t,
        lambda t: t + ".garbage",
        lambda t: t[:-1] + ("A" if t[-1] != "A" else "B"),
        lambda t: t.split(".")[0] + "." + t.split(".")[1] + ".",
        lambda t: _encode(b'{"alg":"none","typ":"JWT"}') + "." + ".".join(t.split(".")[1:]),
        lambda t: t + "=",
        lambda t: "x" * 4097,
    ],
)
def test_malformed_or_modified_tokens_are_rejected(mutate):
    with pytest.raises(ValueError):
        verify_access_token(mutate(_token()), KEY, now=CLOCK)


def test_wrong_key_revocation_clock_and_claim_constraints():
    token = _token()
    with pytest.raises(ValueError):
        verify_access_token(token, bytes(reversed(KEY)), now=CLOCK)
    with pytest.raises(ValueError):
        verify_access_token(token, KEY, now=CLOCK - timedelta(hours=1))
    signed_payload = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))
    bad = (
        {"aud": "unrelated"},
        {"iss": "unrelated"},
        {"role": "superuser"},
        {"sid": "0" * 43},
        {"exp": signed_payload["iat"] + 901},
        {"exp": True},
        {"iat": signed_payload["exp"]},
        {"nbf": signed_payload["iat"] - 1},
        {"jti": "not-a-uuid"},
        {"extra": "untrusted"},
    )
    for difference in bad:
        with pytest.raises(ValueError):
            verify_access_token(_forge({**signed_payload, **difference}), KEY, now=CLOCK)
    repeated = token.split(".")
    duplicated = (
        repeated[1].replace(".", "")
    )
    assert duplicated


def test_invalid_token_issuance_and_external_key_configuration():
    with pytest.raises(ValueError):
        issue_access_token(KEY[:16], _identity(), SESSION_DIGEST, CLOCK + timedelta(hours=1))
    with pytest.raises(ValueError):
        issue_access_token(KEY, _identity(), "not-a-digest", CLOCK + timedelta(hours=1))
    assert decode_signing_key(_encode(KEY)) == KEY
    for invalid in ("short", _encode(KEY) + "=", _encode(KEY[:-1]), _encode(KEY) + "!", ""):
        with pytest.raises(ValueError):
            decode_signing_key(invalid)

    config = {"database_url": "postgresql+psycopg://app:test@localhost/test"}
    with pytest.raises(ValidationError):
        Settings(**config, jwt_access_enabled=True)
    with pytest.raises(ValidationError):
        Settings(**config, jwt_access_enabled=True, identity_enabled=True)
    with pytest.raises(ValidationError):
        Settings(
            **config,
            jwt_access_enabled=True,
            identity_enabled=True,
            auth_database_url="postgresql+psycopg://auth:test@localhost/test",
            jwt_signing_key="insecure",
        )
    active = Settings(
        **config,
        app_env="test",
        identity_enabled=True,
        auth_database_url="postgresql+psycopg://auth:test@localhost/test",
        jwt_access_enabled=True,
        jwt_signing_key=SecretStr(_encode(KEY)),
    )
    assert active.jwt_access_enabled
    assert secrets.compare_digest(decode_signing_key(active.jwt_signing_key.get_secret_value()), KEY)
