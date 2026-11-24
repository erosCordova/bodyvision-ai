"""Exhaustive, deny-by-default RBAC matrix for synthetic private profiles."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from app.core.identity import ConsentState, Identity, authorized


@pytest.mark.parametrize(
    ("role", "action", "access", "purpose", "expected"),
    [
        ("administrator", "admin:manage", None, None, True),
        ("specialist", "admin:manage", None, None, False),
        ("member", "admin:manage", None, None, False),
        ("administrator", "profile:read", "read", None, True),
        ("specialist", "profile:read", "read", None, True),
        ("member", "profile:read", "read", None, True),
        ("administrator", "profile:read", None, None, False),
        ("administrator", "profile:write", "write", None, True),
        ("specialist", "profile:write", "write", None, True),
        ("member", "profile:write", "manage", None, False),
        ("specialist", "profile:write", "read", None, False),
        ("specialist", "capture:create", "write", None, False),
        ("specialist", "capture:create", "write", "capture", True),
        ("member", "capture:create", "manage", "capture", False),
        ("specialist", "pose:run", "write", "pose", True),
        ("specialist", "pose:run", "read", "pose", False),
        ("member", "pose:run", "manage", "pose", False),
        ("administrator", "pose:run", "manage", None, False),
        ("administrator", "pose:run", "manage", "pose", True),
        ("member", "report:read", "read", "report", True),
        ("member", "report:read", "read", "capture", False),
        ("member", "report:read", None, "report", False),
    ],
)
def test_role_capability_matrix(role, action, access, purpose, expected):
    organization = uuid4()
    now = datetime.now(UTC)
    consent = (
        ConsentState(
            purpose=purpose,
            accepted_at=now - timedelta(minutes=1),
            version="bv-synthetic-v1",
            status="accepted",
        )
        if purpose is not None
        else None
    )
    identity = Identity(organization, uuid4(), role, True)
    assert (
        authorized(
            identity,
            organization,
            action,
            access_level=access,
            consent=consent,
            at=now,
        )
        is expected
    )
    assert not authorized(
        identity,
        uuid4(),
        action,
        access_level=access,
        consent=consent,
        at=now,
    )
    assert not authorized(
        Identity(organization, identity.user_id, role, False),
        organization,
        action,
        access_level=access,
        consent=consent,
        at=now,
    )


def test_revoked_consent_never_authorizes_capture_or_reports():
    organization = uuid4()
    identity = Identity(organization, uuid4(), "specialist", True)
    now = datetime.now(UTC)
    for purpose, action in (("capture", "capture:create"), ("report", "report:read")):
        revoked = ConsentState(
            purpose=purpose,
            accepted_at=now - timedelta(days=1),
            revoked_at=now,
            version="bv-synthetic-v1",
            status="revoked",
        )
        assert not authorized(
            identity,
            organization,
            action,
            access_level="manage",
            consent=revoked,
            at=now,
        )
