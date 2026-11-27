"""The hosted sandbox must keep its write surface bounded."""

import pytest

from app.main import sandbox_mutation_allowed

IDENTIFIER = "10000000-0000-4000-8000-000000000001"


@pytest.mark.parametrize(
    ("method", "path", "expected"),
    [
        ("POST", "/api/v1/sandbox/consents", True),
        ("PATCH", f"/api/v1/sandbox/consents/{IDENTIFIER}", True),
        ("DELETE", f"/api/v1/sandbox/consents/{IDENTIFIER}", False),
        ("POST", "/api/v1/auth/admin/users", True),
        ("POST", "/api/v1/auth/register", False),
        ("POST", f"/api/v1/profiles/{IDENTIFIER}/captures", True),
        ("DELETE", f"/api/v1/profiles/{IDENTIFIER}/captures/{IDENTIFIER}", True),
        ("POST", f"/api/v1/profiles/{IDENTIFIER}/scenarios", False),
        ("POST", "/api/v1/auth/mfa/recover", False),
        ("PATCH", "/api/v1/sandbox/consents/not-a-uuid", False),
    ],
)
def test_sandbox_write_allowlist(method, path, expected):
    assert sandbox_mutation_allowed(method, path) is expected
