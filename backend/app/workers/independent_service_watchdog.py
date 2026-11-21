"""Optional local-only API availability monitor, in a separate process.

No credentials, database access, patient data, request bodies or external URLs.
"""

import argparse
import json
import os
import sqlite3
import time
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from app.db.session import SCHEMA_REVISION
from app.workers.watchdog_history import WatchdogHistory
from app.workers.watchdog_incidents import summarize_incidents

HEALTH_PATH = "/api/v1/health/ready"
ALLOWED_TARGETS = frozenset(
    {
        "http://backend:8000" + HEALTH_PATH,
        "http://127.0.0.1:8000" + HEALTH_PATH,
    }
)
MAX_RESPONSE_BYTES = 4096


class WatchdogDenied(ValueError):
    """Fail closed outside explicit synthetic-only local/test environments."""


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def require_synthetic_watchdog(environment: Mapping[str, str]) -> tuple[str, int]:
    if environment.get("APP_ENV") not in {"local", "test"}:
        raise WatchdogDenied("Only local/test is permitted")
    if environment.get("BODYVISION_ENABLE_WATCHDOG") != "synthetic-only":
        raise WatchdogDenied("Explicit synthetic-only opt-in required")
    target = environment.get("WATCHDOG_TARGET", "http://backend:8000" + HEALTH_PATH)
    if target not in ALLOWED_TARGETS:
        raise WatchdogDenied("Only fixed internal readiness targets are permitted")
    try:
        interval = int(environment.get("WATCHDOG_INTERVAL_SECONDS", "30"))
    except (ValueError, TypeError) as exc:
        raise WatchdogDenied("Invalid monitoring interval") from exc
    if not 10 <= interval <= 3600:
        raise WatchdogDenied("Monitoring interval out of range")
    return target, interval


def probe_readiness(target: str, opener=None) -> str:
    """Use only controlled statuses; never expose raw errors or response bodies."""
    if target not in ALLOWED_TARGETS:
        raise WatchdogDenied("Target not allowlisted")
    client = opener if opener is not None else build_opener(ProxyHandler({}), NoRedirects())
    request = Request(target, headers={"Accept": "application/json"}, method="GET")
    try:
        with client.open(request, timeout=3) as response:
            if response.status != 200:
                return "degraded"
            body = response.read(MAX_RESPONSE_BYTES + 1)
    except HTTPError:
        return "degraded"
    except (URLError, TimeoutError, OSError, HTTPException):
        return "unreachable"
    if len(body) > MAX_RESPONSE_BYTES:
        return "degraded"
    try:
        payload = json.loads(body)
    except (UnicodeError, ValueError, TypeError):
        return "degraded"
    if (
        isinstance(payload, dict)
        and payload.get("status") == "ready"
        and payload.get("database") == "connected"
        and payload.get("schema_revision") == SCHEMA_REVISION
    ):
        return "ready"
    return "degraded"


def monitor(
    target: str,
    interval: int,
    *,
    once: bool = False,
    probe: Callable[[str], str] = probe_readiness,
    sleep: Callable[[float], None] = time.sleep,
    emit: Callable[[str], None] = print,
    journal: WatchdogHistory | None = None,
) -> int:
    """Emit a privacy-minimized JSON line only on state transitions."""
    previous = journal.latest_state() if journal is not None else None
    while True:
        state = probe(target)
        if state not in {"ready", "degraded", "unreachable"}:
            state = "degraded"
        checked_at = datetime.now(UTC)
        if journal is not None:
            journal.record_probe(state, checked_at, interval)
        if state != previous:
            saved = journal is None or journal.append_transition(state, checked_at)
            if saved:
                emit(
                    json.dumps(
                        {
                            "event": "synthetic_watchdog_transition",
                            "state": state,
                            "checked_at": checked_at.isoformat(),
                        },
                        sort_keys=True,
                    )
                )
            previous = state
        if once:
            return 0 if state == "ready" else 1
        try:
            sleep(interval)
        except KeyboardInterrupt:
            return 0


def main(argv: list[str] | None = None, environment: Mapping[str, str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Vigilante de disponibilidad ficticia local")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="Consultar una vez y finalizar")
    mode.add_argument("--history", action="store_true", help="Leer historial local acotado")
    mode.add_argument("--incidents", action="store_true", help="Resumir incidentes observados")
    mode.add_argument("--status", action="store_true", help="Consultar vigencia del ultimo sondeo")
    args = parser.parse_args(argv)
    try:
        target, interval = require_synthetic_watchdog(
            os.environ if environment is None else environment
        )
        # Only the isolated watchdog process can access this private volume.
        os.umask(0o077)
        journal = WatchdogHistory()
        if args.history:
            for event in journal.recent():
                print(json.dumps(event, sort_keys=True))
            return 0
        if args.incidents:
            print(json.dumps(summarize_incidents(journal.recent()), sort_keys=True))
            return 0
        if args.status:
            print(json.dumps(journal.probe_status(), sort_keys=True))
            return 0
        return monitor(target, interval, once=args.once, journal=journal)
    except WatchdogDenied:
        print('{"event":"synthetic_watchdog_disabled"}', flush=True)
        return 2
    except (sqlite3.Error, OSError, ValueError):
        print('{"event":"synthetic_watchdog_journal_unavailable"}', flush=True)
        return 3
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
