"""RFC-compatible TOTP, encrypted seeds, and one-use recovery primitives."""

import base64

import pytest

from app.core.mfa import (
    decrypt_totp_seed,
    encrypt_totp_seed,
    generate_mfa_encryption_key,
    hash_recovery_code,
    new_recovery_codes,
    new_totp_seed,
    normalize_recovery_code,
    totp_code,
    totp_enrollment_uri,
    verify_recovery_code,
    verify_totp,
)


def test_totp_rfc6238_sha1_vectors_and_six_digit_format():
    seed = base64.b32encode(b"12345678901234567890").decode("ascii")
    assert totp_code(seed, 59, digits=8) == "94287082"
    assert totp_code(seed, 1111111109, digits=8) == "07081804"
    assert totp_code(seed, 1111111111, digits=8) == "14050471"
    assert len(totp_code(seed, 59)) == 6
    assert totp_code(seed, 59).isdigit()


def test_totp_accepts_one_step_drift_and_rejects_reuse():
    seed = new_totp_seed()
    code = totp_code(seed, 90)
    assert verify_totp(seed, code, 90) == 3
    assert verify_totp(seed, code, 60) == 3
    assert verify_totp(seed, code, 120) == 3
    assert verify_totp(seed, code, 90, last_accepted_step=3) is None
    assert verify_totp(seed, code, 90, last_accepted_step=4) is None
    assert verify_totp(seed, code, 150) is None
    assert verify_totp(seed, "00000x", 90) is None
    assert verify_totp(seed, "1234567", 90) is None
    assert verify_totp(seed, code, -1) is None


def test_totp_seed_randomness_and_input_validation():
    first, second = new_totp_seed(), new_totp_seed()
    assert first != second
    assert len(first) == len(second) == 32
    with pytest.raises(ValueError):
        totp_code("invalid", 59)
    with pytest.raises(ValueError):
        totp_code(first, -1)
    with pytest.raises(ValueError):
        totp_code(first, 59, digits=4)
    with pytest.raises(ValueError):
        totp_enrollment_uri(first, "")
    uri = totp_enrollment_uri(first, "admin@example.invalid")
    assert uri.startswith("otpauth://totp/BODYVISION%20AI%3Aadmin%40example.invalid?")
    assert f"secret={first}" in uri and "period=30" in uri


def test_seed_is_encrypted_at_rest_and_invalid_keys_fail_closed():
    seed = new_totp_seed()
    key, other = generate_mfa_encryption_key(), generate_mfa_encryption_key()
    ciphertext = encrypt_totp_seed(seed, key)
    assert seed not in ciphertext
    assert ciphertext != encrypt_totp_seed(seed, key)
    assert decrypt_totp_seed(ciphertext, key) == seed
    with pytest.raises(ValueError):
        decrypt_totp_seed(ciphertext, other)
    with pytest.raises(ValueError):
        decrypt_totp_seed("tampered", key)


def test_recovery_codes_are_random_and_salted_and_format_tolerant():
    codes = new_recovery_codes()
    assert len(codes) == len(set(codes)) == 8
    assert all(len(c) == 32 for c in codes)
    verifier = hash_recovery_code(codes[0])
    assert codes[0] not in verifier
    assert hash_recovery_code(codes[0]) != verifier
    assert verify_recovery_code(codes[0], verifier)
    formatted = "-".join(codes[0][i : i + 8] for i in range(0, 32, 8)).lower()
    assert normalize_recovery_code(formatted) == codes[0]
    assert verify_recovery_code(formatted, verifier)
    assert not verify_recovery_code(codes[1], verifier)
    assert not verify_recovery_code("not-a-code", verifier)
    with pytest.raises(ValueError):
        hash_recovery_code("short")
