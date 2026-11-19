"""Fernet rotation preserves fictional pixels and rejects obsolete secrets."""

import hashlib

import pytest
from cryptography.fernet import Fernet, InvalidToken
from pydantic import SecretStr, ValidationError

from app.core.config import Settings
from app.services.capture_crypto import CaptureCipher


def config(primary: bytes, old_keys: list[bytes] | None = None) -> Settings:
    return Settings(
        app_env="test",
        identity_enabled=True,
        database_url="postgresql+psycopg://app:test@localhost/test",
        auth_database_url="postgresql+psycopg://auth:test@localhost/test",
        capture_encryption_key=primary.decode(),
        capture_decryption_keys=[SecretStr(item.decode()) for item in (old_keys or [])],
    )


def test_fallback_reads_and_rotates_without_changing_synthetic_payload():
    new = Fernet.generate_key()
    old = Fernet.generate_key()
    plaintext = b"fictitious-pixels-only"
    archived = Fernet(old).encrypt(plaintext)
    cipher = CaptureCipher.from_settings(config(new, [old]))
    assert hashlib.sha256(cipher.decrypt(archived)).hexdigest() == hashlib.sha256(
        plaintext
    ).hexdigest()
    original, rotated = cipher.rotate_if_legacy(archived)
    assert original == plaintext
    assert rotated is not None and rotated != archived
    assert Fernet(new).decrypt(rotated) == plaintext
    assert cipher.rotate_if_legacy(rotated) == (plaintext, None)
    assert CaptureCipher.from_settings(config(new)).decrypt(rotated) == plaintext
    with pytest.raises(InvalidToken):
        CaptureCipher.from_settings(config(old)).decrypt(rotated)


def test_missing_legacy_key_blocks_rotation_without_dropping_ciphertext():
    new = Fernet.generate_key()
    old = Fernet.generate_key()
    archived = Fernet(old).encrypt(b"synthetic")
    with pytest.raises(InvalidToken):
        CaptureCipher.from_settings(config(new)).rotate_if_legacy(archived)
    assert Fernet(old).decrypt(archived) == b"synthetic"


@pytest.mark.parametrize(
    "invalid_keyset",
    [
        lambda a, b: [SecretStr(a.decode())],
        lambda a, b: [SecretStr(b.decode()), SecretStr(b.decode())],
        lambda a, b: [SecretStr("not-a-key")],
    ],
)
def test_invalid_decryption_keyring_fails_configuration(invalid_keyset):
    first, second = Fernet.generate_key(), Fernet.generate_key()
    with pytest.raises(ValidationError):
        config(first, [item.get_secret_value().encode() for item in invalid_keyset(first, second)])


def test_retention_setting_is_bounded():
    first = Fernet.generate_key()
    base = {
        "app_env": "test",
        "identity_enabled": True,
        "database_url": "postgresql+psycopg://app:test@localhost/test",
        "auth_database_url": "postgresql+psycopg://auth:test@localhost/test",
        "capture_encryption_key": first.decode(),
    }
    with pytest.raises(ValidationError):
        Settings(**base, capture_retention_interval_seconds=1)
    with pytest.raises(ValidationError):
        Settings(**base, capture_retention_interval_seconds=90000)
    assert config(first).capture_retention_interval_seconds == 900
