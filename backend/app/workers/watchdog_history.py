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
        connection.commit()
        return connection

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
