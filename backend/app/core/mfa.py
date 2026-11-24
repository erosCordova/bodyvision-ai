"""TOTP and one-time recovery-code primitives for privileged account MFA.

Pure, deterministic checks: the caller must persist the accepted TOTP step and
mark a recovery code consumed in the same serialized database transaction.
Never persist the unencrypted TOTP seed or the plaintext recovery codes.
"""

import base64
import hashlib
import hmac
import re
import secrets
import struct
from urllib.parse import quote, urlencode

from cryptography.fernet import Fernet, InvalidToken

from app.core.identity import hash_recovery_secret, verify_password

TOTP_DIGITS = 6
TOTP_PERIOD = 30
TOTP_DRIFT_STEPS = 1
RECOVERY_CODE_COUNT = 8
_SEED_RE = re.compile(r"^[A-Z2-7]{32}$")
_RECOVERY_RE = re.compile(r"^[0-9A-F]{32}$")


def new_totp_seed() -> str:
    """160 bits of randomness, Base32 encoded for authenticator applications."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii")


def _seed_bytes(seed: str) -> bytes:
    if not isinstance(seed, str) or not _SEED_RE.fullmatch(seed):
        raise ValueError("Invalid TOTP seed")
    decoded = base64.b32decode(seed, casefold=False)
    if len(decoded) != 20:
        raise ValueError("Invalid TOTP seed")
    return decoded


def totp_code(seed: str, timestamp: int, *, digits: int = TOTP_DIGITS) -> str:
    """RFC 6238 HMAC-SHA1, compatible with standard authenticator apps."""
    if type(timestamp) is not int or timestamp < 0 or digits not in {6, 8}:
        raise ValueError("Invalid TOTP parameters")
    counter = timestamp // TOTP_PERIOD
    digest = hmac.new(_seed_bytes(seed), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    truncated = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(truncated % (10**digits)).zfill(digits)


def verify_totp(
    seed: str,
    submitted: str,
    timestamp: int,
    *,
    last_accepted_step: int = -1,
) -> int | None:
    """Return the TOTP counter to persist, or None for invalid/replayed codes.

    A maximum drift of one 30-second step is accepted on either side. Comparing
    every candidate helps avoid revealing the matching drift position.
    """
    if (
        not isinstance(submitted, str)
        or re.fullmatch(r"[0-9]{6}", submitted) is None
        or type(timestamp) is not int
        or timestamp < 0
        or type(last_accepted_step) is not int
        or last_accepted_step < -1
    ):
        return None
    current = timestamp // TOTP_PERIOD
    accepted = None
    for counter in range(max(0, current - TOTP_DRIFT_STEPS), current + TOTP_DRIFT_STEPS + 1):
        candidate = totp_code(seed, counter * TOTP_PERIOD)
        matches = hmac.compare_digest(candidate, submitted)
        if matches and counter > last_accepted_step:
            accepted = counter if accepted is None else max(accepted, counter)
    return accepted


def new_recovery_codes() -> list[str]:
    """Eight independent 128-bit codes. Reveal each only during enrollment."""
    return [secrets.token_hex(16).upper() for _ in range(RECOVERY_CODE_COUNT)]


def normalize_recovery_code(code: str) -> str:
    if not isinstance(code, str):
        raise ValueError("Invalid recovery code")
    canonical = code.replace("-", "").replace(" ", "").upper()
    if not _RECOVERY_RE.fullmatch(canonical):
        raise ValueError("Invalid recovery code")
    return canonical


def hash_recovery_code(code: str) -> str:
    """Use the application's salted PBKDF2 verifier, not plain SHA-256."""
    return hash_recovery_secret(normalize_recovery_code(code))


def verify_recovery_code(code: str, stored_hash: str) -> bool:
    try:
        return verify_password(normalize_recovery_code(code), stored_hash)
    except ValueError:
        return False


def generate_mfa_encryption_key() -> str:
    """Generate a secret encryption key for an external secrets manager."""
    return Fernet.generate_key().decode("ascii")


def encrypt_totp_seed(seed: str, encryption_key: str) -> str:
    _seed_bytes(seed)
    return Fernet(encryption_key.encode("ascii")).encrypt(seed.encode("ascii")).decode("ascii")


def decrypt_totp_seed(ciphertext: str, encryption_key: str) -> str:
    try:
        seed = (
            Fernet(encryption_key.encode("ascii"))
            .decrypt(ciphertext.encode("ascii"))
            .decode("ascii")
        )
        _seed_bytes(seed)
        return seed
    except (ValueError, UnicodeError, InvalidToken, TypeError) as exc:
        raise ValueError("Unable to decrypt TOTP seed") from exc


def totp_enrollment_uri(seed: str, account_label: str) -> str:
    """Compatible otpauth URI; never log or persist it outside onboarding."""
    _seed_bytes(seed)
    if not account_label or len(account_label) > 254:
        raise ValueError("Invalid account label")
    issuer = "BODYVISION AI"
    label = quote(f"{issuer}:{account_label}", safe="")
    params = urlencode(
        {"secret": seed, "issuer": issuer, "algorithm": "SHA1", "digits": 6, "period": 30}
    )
    return f"otpauth://totp/{label}?{params}"
