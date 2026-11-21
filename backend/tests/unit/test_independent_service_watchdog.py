"""Isolated tests of optional monitoring; no HTTP network or live accounts."""
import io
import json
from urllib.error import HTTPError, URLError

import pytest

from app.db.session import SCHEMA_REVISION
from app.workers.independent_service_watchdog import (
    MAX_RESPONSE_BYTES, WatchdogDenied, main, monitor, probe_readiness,
    require_synthetic_watchdog,
)

TARGET = "http://backend:8000/api/v1/health/ready"
ENV = {"APP_ENV": "test", "BODYVISION_ENABLE_WATCHDOG": "synthetic-only"}


class Response:
    status = 200

    def __init__(self, body):
        self.data = io.BytesIO(body)

    def read(self, size):
        return self.data.read(size)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class Opener:
    def __init__(self, outcome):
        self.outcome = outcome
        self.requests = []

    def open(self, request, timeout):
        self.requests.append((request.full_url, request.get_method(), timeout))
        if isinstance(self.outcome, BaseException):
            raise self.outcome
        return self.outcome


def test_requires_explicit_synthetic_opt_in_bounded_interval_and_internal_target():
    assert require_synthetic_watchdog(ENV) == (TARGET, 30)
    assert require_synthetic_watchdog({**ENV, "WATCHDOG_INTERVAL_SECONDS": "10"})[1] == 10
    for changes in (
        {"APP_ENV": "production"}, {"APP_ENV": "demo"},
        {"BODYVISION_ENABLE_WATCHDOG": "true"},
        {"BODYVISION_ENABLE_WATCHDOG": ""},
        {"WATCHDOG_TARGET": "http://outside.invalid/api/v1/health/ready"},
        {"WATCHDOG_TARGET": "http://backend:8000/api/v1/auth/operations"},
        {"WATCHDOG_TARGET": "https://backend:8000/api/v1/health/ready"},
        {"WATCHDOG_TARGET": "http://backend:8000/api/v1/health/ready?token=secret"},
        {"WATCHDOG_INTERVAL_SECONDS": "0"}, {"WATCHDOG_INTERVAL_SECONDS": "3601"},
        {"WATCHDOG_INTERVAL_SECONDS": "bad"},
    ):
        with pytest.raises(WatchdogDenied):
            require_synthetic_watchdog({**ENV, **changes})
    with pytest.raises(WatchdogDenied):
        probe_readiness("http://outside.invalid/")


def test_probe_requires_ready_database_and_current_revision_without_redirects():
    healthy = json.dumps({
        "status": "ready", "database": "connected", "schema_revision": SCHEMA_REVISION
    }).encode()
    opener = Opener(Response(healthy))
    assert probe_readiness(TARGET, opener=opener) == "ready"
    assert opener.requests == [(TARGET, "GET", 3)]
    for item in (
        {"status": "ready", "database": "connected", "schema_revision": "old"},
        {"status": "alive", "database": "connected", "schema_revision": SCHEMA_REVISION},
        ["ready"],
    ):
        assert probe_readiness(
            TARGET, opener=Opener(Response(json.dumps(item).encode()))
        ) == "degraded"
    assert probe_readiness(TARGET, opener=Opener(Response(b"invalid json"))) == "degraded"
    assert probe_readiness(
        TARGET, opener=Opener(Response(b"x" * (MAX_RESPONSE_BYTES + 1)))
    ) == "degraded"
    for status in (302, 503):
        assert probe_readiness(
            TARGET, opener=Opener(HTTPError(TARGET, status, "not ready", {}, None))
        ) == "degraded"
    assert probe_readiness(
        TARGET, opener=Opener(URLError("connection refused private host"))
    ) == "unreachable"


def test_outage_recovery_emits_only_transition_states_without_private_details():
    states = iter(["unreachable", "unreachable", "degraded", "ready"])
    records = []
    iterations = 0

    def finish(_interval):
        nonlocal iterations
        iterations += 1
        if iterations == 4:
            raise KeyboardInterrupt

    assert monitor(
        TARGET, 10, probe=lambda _: next(states), sleep=finish,
        emit=records.append,
    ) == 0
    messages = [json.loads(line) for line in records]
    assert [message["state"] for message in messages] == [
        "unreachable", "degraded", "ready"
    ]
    assert all(set(message) == {"event", "state", "checked_at"} for message in messages)
    assert TARGET not in "".join(records)
    assert "connection refused" not in "".join(records)


def test_single_probe_exit_codes_and_disallowed_environment(capsys):
    assert monitor(TARGET, 30, once=True, probe=lambda _: "ready", emit=lambda _: None) == 0
    assert monitor(TARGET, 30, once=True, probe=lambda _: "unreachable", emit=lambda _: None) == 1
    assert main(["--once"], {"APP_ENV": "production", "BODYVISION_ENABLE_WATCHDOG": "synthetic-only"}) == 2
    assert capsys.readouterr().out.strip() == '{"event":"synthetic_watchdog_disabled"}'
