from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from app.core.identity import (
    ConsentState,
    Identity,
    authorized,
    hash_password,
    hash_session_token,
    issue_session_token,
    login_bucket_digest,
    valid_consent,
    verify_password,
)


def test_hashes_are_salted_and_passwords_never_stored_plaintext():
    first = hash_password("Some strong demo passphrase 2026!")
    second = hash_password("Some strong demo passphrase 2026!")
    assert first != second
    assert "Some strong" not in first
    assert verify_password("Some strong demo passphrase 2026!", first)
    assert not verify_password("not the right password", first)
    assert not verify_password("Some strong demo passphrase 2026!", "corrupted")
    assert first.startswith("$argon2id$v=19$m=65536,t=3,p=4$")
    assert not verify_password("Some strong demo passphrase 2026!", first.replace("m=65536", "m=1"))
    assert not verify_password("Some strong demo passphrase 2026!", first[:-2])
    with pytest.raises(ValueError):
        hash_password("too-short")


def test_login_throttle_bucket_is_pseudonymous_and_tenant_scoped():
    organization = uuid4()
    same_address = "Tester@Example.Invalid"
    digest = login_bucket_digest(organization, same_address)
    assert len(digest) == 64
    assert same_address.lower() not in digest
    assert login_bucket_digest(organization, " tester@example.invalid ") == digest
    assert login_bucket_digest(uuid4(), same_address) != digest
    assert login_bucket_digest(organization, "other@example.invalid") != digest


def test_session_tokens_are_random_and_only_digest_is_persisted():
    token, digest = issue_session_token()
    again, second = issue_session_token()
    assert token != again
    assert digest != second
    assert token not in digest
    assert len(digest) == 64
    assert hash_session_token(token) == digest
    with pytest.raises(ValueError):
        hash_session_token("short")
    with pytest.raises(ValueError):
        hash_session_token("ñ" * 45)
    # Session IDs are exactly 32 random bytes encoded as 43 base64url characters.
    # Reject alternate lengths, whitespace, padded tokens and punctuation
    # before reaching the session lookup in PostgreSQL.
    malformed_tokens = (
        "A" * 42,
        "A" * 44,
        "A" * 43 + "=",
        "A" * 42 + "/",
        "A" * 42 + " ",
        "A" * 42 + "\t",
    )
    for malformed in malformed_tokens:
        with pytest.raises(ValueError):
            hash_session_token(malformed)


def test_privacy_officer_never_inherits_generic_clinical_or_admin_actions():
    organization = uuid4()
    officer = Identity(organization, uuid4(), "privacy_officer", True)
    for action in (
        "admin:manage",
        "profile:read",
        "profile:write",
        "capture:create",
        "pose:run",
        "report:read",
    ):
        for level in (None, "read", "write", "manage"):
            assert not authorized(officer, organization, action, access_level=level)


def test_tenant_and_role_boundaries_are_default_deny():
    organization = uuid4()
    wrong_organization = uuid4()
    admin = Identity(organization, uuid4(), "administrator", True)
    specialist = Identity(organization, uuid4(), "specialist", True)
    member = Identity(organization, uuid4(), "member", True)
    disabled = Identity(organization, uuid4(), "administrator", False)

    assert authorized(admin, organization, "admin:manage")
    assert not authorized(specialist, organization, "admin:manage")
    assert not authorized(member, organization, "admin:manage")
    assert not authorized(admin, organization, "profile:read")
    assert not authorized(admin, wrong_organization, "admin:manage")
    assert not authorized(disabled, organization, "admin:manage")
    assert not authorized(
        Identity(organization, uuid4(), "unassigned", True),
        organization,
        "profile:read",
        access_level="manage",
    )
    assert not authorized(None, organization, "profile:read", access_level="manage")

    assert authorized(member, organization, "profile:read", access_level="read")
    assert not authorized(member, organization, "profile:write", access_level="manage")
    assert authorized(specialist, organization, "profile:write", access_level="write")
    assert not authorized(specialist, organization, "profile:write", access_level="read")


def test_consent_is_purpose_bound_and_revocation_is_respected():
    organization = uuid4()
    specialist = Identity(organization, uuid4(), "specialist", True)
    now = datetime.now(UTC)
    capture = ConsentState("capture", now - timedelta(minutes=1), version="v1", status="accepted")
    pose = ConsentState("pose", now - timedelta(minutes=1), version="v1", status="accepted")
    revoked = ConsentState(
        "capture", now - timedelta(hours=1), revoked_at=now, version="v1", status="revoked"
    )
    expired = ConsentState(
        "capture",
        now - timedelta(days=2),
        expires_at=now - timedelta(days=1),
        version="v1",
        status="accepted",
    )

    assert valid_consent(capture, "capture", now)
    assert not valid_consent(capture, "pose", now)
    assert not valid_consent(revoked, "capture", now)
    assert not valid_consent(expired, "capture", now)
    assert not valid_consent(
        ConsentState("capture", now + timedelta(days=1), version="v1", status="accepted"),
        "capture",
        now,
    )
    assert not valid_consent(None, "capture", now)
    assert not valid_consent(ConsentState("capture", now), "capture", now)

    assert authorized(
        specialist, organization, "capture:create", access_level="write", consent=capture, at=now
    )
    assert not authorized(
        specialist, organization, "capture:create", access_level="write", consent=revoked, at=now
    )
    assert not authorized(
        specialist, organization, "pose:run", access_level="manage", consent=capture, at=now
    )
    assert authorized(
        specialist, organization, "pose:run", access_level="manage", consent=pose, at=now
    )
    assert not authorized(
        specialist, organization, "pose:run", access_level="read", consent=pose, at=now
    )
