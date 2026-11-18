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
    assert not verify_password("Some strong demo passphrase 2026!", first.replace("600000", "1"))
    assert not verify_password("Some strong demo passphrase 2026!", first[:-2])
    with pytest.raises(ValueError):
        hash_password("too-short")


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
