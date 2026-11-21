"""Bounded synthetic incident history and recovery across fresh processes."""

import json
import sqlite3
from datetime import UTC, datetime, timedelta

import pytest

from app.workers.independent_service_watchdog import monitor
from app.workers.watchdog_history import (
    HISTORY_RETENTION_DAYS,
    MAX_HISTORY_EVENTS,
    WatchdogHistory,
)

TARGET = "http://backend:8000/api/v1/health/ready"


def test_history_survives_fresh_instance_and_does_not_repeat_identical_events(tmp_path):
    path = tmp_path / "events.sqlite3"
    first = WatchdogHistory(path)
    now = datetime.now(UTC)
    assert first.append_transition("unreachable", now) is True
    assert first.append_transition("unreachable", now) is False
    restarted = WatchdogHistory(path)
    assert restarted.latest_state() == "unreachable"
    assert restarted.append_transition("ready", now + timedelta(seconds=1)) is True
    assert [event["state"] for event in restarted.recent()] == ["unreachable", "ready"]
    for event in restarted.recent():
        assert set(event) == {"event", "state", "checked_at"}
        assert "backend" not in json.dumps(event)


def test_history_is_limited_to_seven_days_and_256_transitions(tmp_path):
    journal = WatchdogHistory(tmp_path / "events.sqlite3")
    now = datetime.now(UTC)
    journal.append_transition("degraded", now)
    with sqlite3.connect(journal.path) as connection:
        connection.execute(
            "INSERT INTO watchdog_events(state, checked_at) VALUES (?, ?)",
            ("unreachable", (now - timedelta(days=HISTORY_RETENTION_DAYS + 2)).isoformat()),
        )
    assert len(journal.recent()) == 1
    for index in range(MAX_HISTORY_EVENTS + 40):
        journal.append_transition(
            "ready" if index % 2 else "unreachable",
            now + timedelta(microseconds=index + 1),
        )
    events = journal.recent()
    assert len(events) == MAX_HISTORY_EVENTS
    assert events[0]["state"] == "unreachable"
    assert events[-1]["state"] == "ready"


def test_monitor_resumes_from_saved_state_across_restarts(tmp_path):
    path = tmp_path / "events.sqlite3"
    outputs = []
    for state, expected in (("unreachable", 1), ("unreachable", 1), ("ready", 0)):
        assert (
            monitor(
                TARGET,
                30,
                once=True,
                probe=lambda _, observed=state: observed,
                emit=outputs.append,
                journal=WatchdogHistory(path),
            )
            == expected
        )
    assert [json.loads(event)["state"] for event in outputs] == ["unreachable", "ready"]


def test_history_refuses_other_states_and_corrupted_database(tmp_path):
    journal = WatchdogHistory(tmp_path / "events.sqlite3")
    with pytest.raises(ValueError):
        journal.append_transition("patient:secret", datetime.now(UTC))
    with pytest.raises(ValueError):
        journal.append_transition("ready", datetime(2026, 11, 20))
    assert journal.recent() == []
    broken = tmp_path / "broken.sqlite3"
    broken.write_bytes(b"not a database")
    with pytest.raises(sqlite3.DatabaseError):
        WatchdogHistory(broken).recent()
