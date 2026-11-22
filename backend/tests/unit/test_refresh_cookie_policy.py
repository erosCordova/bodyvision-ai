"""Refresh-cookie attributes without a database: secure contexts vs local/test."""

import re
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from starlette.requests import Request
from starlette.responses import Response

from app.services.auth_sessions import SessionRead
from app.services.cookie_access import REFRESH_COOKIE, REFRESH_PATH, _set_refresh_cookie


def _request(scheme: str) -> Request:
    port = 443 if scheme == "https" else 80
    return Request(
        {
            "type": "http",
            "scheme": scheme,
            "server": ("testserver", port),
            "path": REFRESH_PATH + "/refresh",
            "root_path": "",
            "query_string": b"",
            "headers": [],
            "client": ("127.0.0.1", 5000),
        }
    )


def _session(minutes: int = 60) -> SessionRead:
    return SessionRead(
        token="A" * 43,
        expires_at=datetime.now(UTC) + timedelta(minutes=minutes),
        organization_id=uuid4(),
        user_id=uuid4(),
        role="member",
    )


def test_refresh_cookie_is_http_only_strict_and_path_scoped_over_tls():
    response = Response()
    _set_refresh_cookie(_request("https"), response, _session())

    header = response.headers["set-cookie"]
    lowered = header.lower()
    assert lowered.startswith(f"{REFRESH_COOKIE}=")
    assert "httponly" in lowered
    assert "samesite=strict" in lowered
    assert "secure" in lowered
    assert f"path={REFRESH_PATH}" in lowered
    max_age = re.search(r"max-age=(\d+)", lowered)
    assert max_age is not None and 0 < int(max_age.group(1)) <= 3600
    assert "domain=" not in lowered


def test_refresh_cookie_omits_secure_only_on_plain_http_local_test():
    response = Response()
    _set_refresh_cookie(_request("http"), response, _session())

    lowered = response.headers["set-cookie"].lower()
    assert "httponly" in lowered and "samesite=strict" in lowered
    # Documented limit: deployment behind TLS termination must expose https
    # (or trusted forwarded scheme) or the browser never receives Secure.
    assert "secure" not in lowered


def test_refresh_cookie_expires_immediately_for_a_closed_session():
    response = Response()
    _set_refresh_cookie(_request("https"), response, _session(minutes=-1))

    lowered = response.headers["set-cookie"].lower()
    assert "max-age=0" in lowered
