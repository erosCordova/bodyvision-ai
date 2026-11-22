from unittest.mock import MagicMock

import pytest

from app.core import identity
from app.core.mfa import hash_recovery_code, verify_recovery_code

PASSWORD = "Legacy compatibility test 2026!"


def test_current_policy_and_legacy_passwords_verify_without_changing_the_password():
    legacy = identity._hash_legacy_secret(PASSWORD)
    current = identity.hash_password(PASSWORD)
    assert identity.verify_password(PASSWORD, legacy)
    assert identity.verify_password(PASSWORD, current)
    assert identity.password_needs_upgrade(legacy)
    assert not identity.password_needs_upgrade(current)
    assert not identity.verify_password("wrong", legacy)


@pytest.mark.parametrize(
    "parameters",
    ["m=1,t=3,p=4", "m=1073741824,t=3,p=4", "m=65536,t=999999,p=4", "m=65536,t=3,p=128"],
)
def test_untrusted_argon2_parameters_never_reach_the_memory_kdf(monkeypatch, parameters):
    known = identity.hash_password(PASSWORD)
    hasher = MagicMock()
    monkeypatch.setattr(identity, "_ARGON2", hasher)
    altered = known.replace("m=65536,t=3,p=4", parameters)
    assert not identity.verify_password(PASSWORD, altered)
    hasher.verify.assert_not_called()


def test_recovery_verifiers_preserve_their_separate_historical_format():
    code = "A" * 32
    stored = hash_recovery_code(code)
    assert stored.startswith("pbkdf2_sha256$600000$")
    assert verify_recovery_code(code, stored)
    assert not verify_recovery_code("B" * 32, stored)


def test_invalid_inputs_and_salts_fail_closed():
    for value in (None, "bad", "$argon2id$" + "x" * 1000):
        assert not identity.verify_password(PASSWORD, value)
        assert not identity.password_needs_upgrade(value)
    with pytest.raises(ValueError):
        identity.hash_password(PASSWORD, salt=b"short")
