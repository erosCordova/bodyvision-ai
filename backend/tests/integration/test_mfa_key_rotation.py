"""Offline MFA re-encryption must be atomic, audited, and local-only."""

import os
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.core.mfa import (
    decrypt_totp_seed,
    encrypt_totp_seed,
    generate_mfa_encryption_key,
    new_totp_seed,
)
from app.maintenance.rotate_synthetic_mfa_key import (
    RotationDenied,
    require_local_rotation,
    rotate_synthetic_mfa_key,
    validate_distinct_keys,
)

ALLOWED = {
    "APP_ENV": "test",
    "IDENTITY_ENABLED": "true",
    "MFA_ENABLED": "true",
    "BODYVISION_ENABLE_MFA_KEY_ROTATION": "synthetic-only",
}
LOOPBACK = "postgresql+psycopg://postgres@127.0.0.1/bodyvision"


@pytest.mark.parametrize(
    ("changes", "url"),
    [
        ({"APP_ENV": "demo"}, LOOPBACK),
        ({"APP_ENV": "production"}, LOOPBACK),
        ({"MFA_ENABLED": "false"}, LOOPBACK),
        ({"IDENTITY_ENABLED": "false"}, LOOPBACK),
        ({"BODYVISION_ENABLE_MFA_KEY_ROTATION": ""}, LOOPBACK),
        ({}, "postgresql+psycopg://postgres@db-test:5432/bodyvision"),
        ({}, "postgresql+psycopg://postgres@neon.tech/bodyvision"),
        ({}, "sqlite:///local.db"),
    ],
)
def test_rotation_denies_public_and_nonlocal_environments(changes, url):
    with pytest.raises(RotationDenied):
        require_local_rotation({**ALLOWED, **changes}, url)


def test_rotation_requires_valid_distinct_cryptographic_keys():
    first, next_key = generate_mfa_encryption_key(), generate_mfa_encryption_key()
    validate_distinct_keys(first, next_key)
    for old, new in [(first, first), ("", next_key), (first, "bad-key")]:
        with pytest.raises(RotationDenied):
            validate_distinct_keys(old, new)


@pytest.fixture
def local_owner():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url or make_url(url).host not in {"localhost", "127.0.0.1", "::1"}:
        pytest.skip("Run positive rotation against local PostgreSQL only")
    engine = create_engine(url, hide_parameters=True)
    try:
        with engine.connect() as connection:
            transaction = connection.begin()
            try:
                yield connection
            finally:
                transaction.rollback()
    finally:
        engine.dispose()


def add_test_factor(connection, cipher: str):
    organization, actor = uuid4(), uuid4()
    connection.execute(
        text(
            "INSERT INTO public.organizations (id,name,synthetic) "
            "VALUES (:org,'Organización ficticia de cifrado',true)"
        ),
        {"org": organization},
    )
    connection.execute(
        text(
            "INSERT INTO public.users "
            "(id,organization_id,display_name,is_local_operator,email,account_status) "
            "VALUES (:actor,:org,'Operador MFA sintético',false,:email,'active')"
        ),
        {
            "actor": actor,
            "org": organization,
            "email": f"rotation-{actor.hex[:12]}@example.invalid",
        },
    )
    connection.execute(
        text(
            "INSERT INTO public.private_mfa_credentials "
            "(organization_id,user_id,encrypted_totp_seed) "
            "VALUES (:org,:actor,:cipher)"
        ),
        {"org": organization, "actor": actor, "cipher": cipher},
    )
    return organization, actor


def test_rotation_reencrypts_all_synthetic_factors_and_appends_audit(local_owner):
    old_key, new_key = generate_mfa_encryption_key(), generate_mfa_encryption_key()
    first, second = new_totp_seed(), new_totp_seed()
    first_org, first_user = add_test_factor(local_owner, encrypt_totp_seed(first, old_key))
    second_org, second_user = add_test_factor(local_owner, encrypt_totp_seed(second, old_key))
    count = rotate_synthetic_mfa_key(local_owner, old_key, new_key, environment=ALLOWED)
    assert count == 2
    for org, user, seed in [
        (first_org, first_user, first),
        (second_org, second_user, second),
    ]:
        updated = local_owner.execute(
            text(
                "SELECT encrypted_totp_seed FROM public.private_mfa_credentials "
                "WHERE organization_id=:org AND user_id=:user"
            ),
            {"org": org, "user": user},
        ).scalar_one()
        assert decrypt_totp_seed(updated, new_key) == seed
        with pytest.raises(ValueError):
            decrypt_totp_seed(updated, old_key)
        audit = (
            local_owner.execute(
                text(
                    "SELECT action,chain_sequence,event_hash FROM public.security_audit_events "
                    "WHERE organization_id=:org"
                ),
                {"org": org},
            )
            .mappings()
            .one()
        )
        assert audit["action"] == "mfa.key_rotated_synthetic"
        assert audit["chain_sequence"] == 1
        assert len(audit["event_hash"]) == 64


def test_rotation_fails_before_writing_anything_when_one_cipher_is_invalid(local_owner):
    old_key, new_key = generate_mfa_encryption_key(), generate_mfa_encryption_key()
    original = encrypt_totp_seed(new_totp_seed(), old_key)
    first_org, first_user = add_test_factor(local_owner, original)
    second_org, second_user = add_test_factor(local_owner, "Z" * 100)
    with pytest.raises(RotationDenied, match="Sin cambios"):
        rotate_synthetic_mfa_key(local_owner, old_key, new_key, environment=ALLOWED)
    for org, user in [(first_org, first_user), (second_org, second_user)]:
        ciphertext = local_owner.execute(
            text(
                "SELECT encrypted_totp_seed FROM public.private_mfa_credentials "
                "WHERE organization_id=:org AND user_id=:user"
            ),
            {"org": org, "user": user},
        ).scalar_one()
        assert ciphertext == (original if user == first_user else "Z" * 100)
    audited = local_owner.execute(
        text("SELECT count(*) FROM public.security_audit_events WHERE organization_id IN (:a,:b)"),
        {"a": first_org, "b": second_org},
    ).scalar_one()
    assert audited == 0


def test_rotation_denies_active_sessions_without_writing(local_owner):
    old_key, new_key = generate_mfa_encryption_key(), generate_mfa_encryption_key()
    original = encrypt_totp_seed(new_totp_seed(), old_key)
    organization, user = add_test_factor(local_owner, original)
    local_owner.execute(
        text(
            "INSERT INTO public.auth_sessions "
            "(id,organization_id,user_id,token_sha256,expires_at) "
            "VALUES (:id,:org,:user,:digest,now()+interval '1 hour')"
        ),
        {"id": uuid4(), "org": organization, "user": user, "digest": "c" * 64},
    )
    with pytest.raises(RotationDenied, match="sesiones MFA activas"):
        rotate_synthetic_mfa_key(local_owner, old_key, new_key, environment=ALLOWED)
    current = local_owner.execute(
        text(
            "SELECT encrypted_totp_seed FROM public.private_mfa_credentials "
            "WHERE organization_id=:org AND user_id=:user"
        ),
        {"org": organization, "user": user},
    ).scalar_one()
    assert current == original
    events = local_owner.execute(
        text("SELECT count(*) FROM public.security_audit_events WHERE organization_id=:org"),
        {"org": organization},
    ).scalar_one()
    assert events == 0
