"""Minimal private SQLite journal for local synthetic watchdog transitions."""

import sqlite3
from contextlib import closing
from datetime import UTC, datetime, timedelta
from pathlib import Path

WATCHDOG_HISTORY_PATH = Path("/var/lib/bodyvision-watchdog/events.sqlite3")
MAX_HISTORY_EVENTS = 256
HISTORY_RETENTION_DAYS = 7
STATES = frozenset({"ready", "degraded", "unreachable"})


class WatchdogHistory:
    def __init__(self, path: Path = WATCHDOG_HISTORY_PATH):
        self.path = path

    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=2)
        connection.execute("PRAGMA busy_timeout=2000")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS watchdog_events (
                id INTEGER PRIMARY KEY,
                state TEXT NOT NULL CHECK(state IN ('ready','degraded','unreachable')),
                checked_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS watchdog_latest_probe (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                state TEXT NOT NULL CHECK(state IN ('ready','degraded','unreachable')),
                checked_at TEXT NOT NULL,
                interval_seconds INTEGER NOT NULL CHECK(interval_seconds BETWEEN 10 AND 3600)
            )
            """
        )
        connection.commit()
        return connection

    def record_probe(self, state: str, checked_at: datetime, interval_seconds: int) -> None:
        """Store only the latest check, not a second unbounded event stream."""
        if state not in STATES or checked_at.tzinfo is None:
            raise ValueError("Invalid synthetic watchdog probe")
        if type(interval_seconds) is not int or not 10 <= interval_seconds <= 3600:
            raise ValueError("Invalid synthetic watchdog interval")
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    """
                    INSERT INTO watchdog_latest_probe(id,state,checked_at,interval_seconds)
                    VALUES (1,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET
                        state=excluded.state,
                        checked_at=excluded.checked_at,
                        interval_seconds=excluded.interval_seconds
                    """,
                    (state, checked_at.astimezone(UTC).isoformat(), interval_seconds),
                )

    def probe_status(self, now: datetime | None = None) -> dict[str, object]:
        """Describe freshness of the last *observation*, never current availability."""
        current = datetime.now(UTC) if now is None else now
        if current.tzinfo is None:
            raise ValueError("An aware clock is required")
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT state, checked_at, interval_seconds "
                "FROM watchdog_latest_probe WHERE id = 1"
            ).fetchone()
        status: dict[str, object] = {
            "event": "synthetic_watchdog_probe_status",
            "scope": "local_last_observation_not_live_availability",
            "last_observed_state": None,
            "last_checked_at": None,
            "age_seconds": None,
            "freshness": "never_observed",
        }
        if row is None:
            return status
        state, checked_at, interval_seconds = row
        if state not in STATES or not 10 <= interval_seconds <= 3600:
            raise ValueError("Invalid saved probe")
        checked = datetime.fromisoformat(checked_at)
        if checked.tzinfo is None:
            raise ValueError("Invalid saved timestamp")
        age = (current - checked).total_seconds()
        if age < 0:
            freshness = "clock_inconsistent"
        elif age > 3 * interval_seconds + 5:
            freshness = "stale"
        else:
            freshness = "recent"
        status.update(
            {
                "last_observed_state": state,
                "last_checked_at": checked.astimezone(UTC).isoformat(),
                "age_seconds": round(age, 3) if age >= 0 else None,
                "freshness": freshness,
            }
        )
        return status

    @staticmethod
    def _prune(connection, now: datetime) -> None:
        cutoff = (now - timedelta(days=HISTORY_RETENTION_DAYS)).isoformat()
        connection.execute("DELETE FROM watchdog_events WHERE checked_at < ?", (cutoff,))
        connection.execute(
            """
            DELETE FROM watchdog_events
            WHERE id NOT IN (
                SELECT id FROM watchdog_events ORDER BY id DESC LIMIT ?
            )
            """,
            (MAX_HISTORY_EVENTS,),
        )

    def latest_state(self) -> str | None:
        with closing(self._connect()) as connection:
            with connection:
                self._prune(connection, datetime.now(UTC))
                row = connection.execute(
                    "SELECT state FROM watchdog_events ORDER BY id DESC LIMIT 1"
                ).fetchone()
            return row[0] if row else None

    def append_transition(self, state: str, checked_at: datetime) -> bool:
        if state not in STATES or checked_at.tzinfo is None:
            raise ValueError("Invalid synthetic watchdog event")
        with closing(self._connect()) as connection:
            with connection:
                self._prune(connection, checked_at)
                previous = connection.execute(
                    "SELECT state FROM watchdog_events ORDER BY id DESC LIMIT 1"
                ).fetchone()
                if previous and previous[0] == state:
                    return False
                connection.execute(
                    "INSERT INTO watchdog_events(state, checked_at) VALUES (?, ?)",
                    (state, checked_at.astimezone(UTC).isoformat()),
                )
                self._prune(connection, checked_at)
        return True

    def recent(self) -> list[dict[str, str]]:
        with closing(self._connect()) as connection:
            with connection:
                self._prune(connection, datetime.now(UTC))
                rows = connection.execute(
                    """
                    SELECT state, checked_at FROM watchdog_events
                    ORDER BY id DESC LIMIT ?
                    """,
                    (MAX_HISTORY_EVENTS,),
                ).fetchall()
        return [
            {
                "event": "synthetic_watchdog_transition",
                "state": state,
                "checked_at": checked_at,
            }
            for state, checked_at in reversed(rows)
        ]
