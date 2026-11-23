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


def test_probe_status_is_empty_until_an_explicit_check(tmp_path):
    journal = WatchdogHistory(tmp_path / "events.sqlite3")
    result = journal.probe_status()
    assert result == {
        "event": "synthetic_watchdog_probe_status",
        "scope": "local_last_observation_not_live_availability",
        "last_observed_state": None,
        "last_checked_at": None,
        "age_seconds": None,
        "freshness": "never_observed",
    }
    assert journal.recent() == []


def test_probe_freshness_turns_stale_without_a_new_transition(tmp_path):
    journal = WatchdogHistory(tmp_path / "events.sqlite3")
    checked = datetime.now(UTC)
    journal.record_probe("ready", checked, 10)
    recent = journal.probe_status(checked + timedelta(seconds=34))
    assert recent["freshness"] == "recent"
    assert recent["last_observed_state"] == "ready"
    assert recent["age_seconds"] == 34
    stale = WatchdogHistory(journal.path).probe_status(checked + timedelta(seconds=36))
    assert stale["freshness"] == "stale"
    assert stale["last_observed_state"] == "ready"
    assert stale["age_seconds"] == 36
    assert stale["scope"] == "local_last_observation_not_live_availability"
    assert journal.recent() == []


def test_latest_probe_is_one_row_across_restarts_and_changes(tmp_path):
    path = tmp_path / "events.sqlite3"
    start = datetime.now(UTC)
    WatchdogHistory(path).record_probe("unreachable", start, 30)
    WatchdogHistory(path).record_probe("ready", start + timedelta(seconds=10), 30)
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM watchdog_latest_probe").fetchone()[0] == 1
    result = WatchdogHistory(path).probe_status(start + timedelta(seconds=11))
    assert result["last_observed_state"] == "ready"
    assert result["freshness"] == "recent"
    assert result["age_seconds"] == 1


def test_clock_inconsistency_does_not_show_healthy_or_invent_age(tmp_path):
    journal = WatchdogHistory(tmp_path / "events.sqlite3")
    sample = datetime.now(UTC)
    journal.record_probe("ready", sample, 10)
    result = journal.probe_status(sample - timedelta(seconds=2))
    assert result["freshness"] == "clock_inconsistent"
    assert result["age_seconds"] is None
    assert result["last_observed_state"] == "ready"


def test_probe_rejects_other_states_intervals_and_naive_timestamps(tmp_path):
    journal = WatchdogHistory(tmp_path / "events.sqlite3")
    now = datetime.now(UTC)
    for state, when, interval in (
        ("secret-user", now, 30),
        ("ready", datetime(2026, 11, 20), 30),
        ("ready", now, 0),
        ("ready", now, 3601),
        ("ready", now, True),
    ):
        with pytest.raises(ValueError):
            journal.record_probe(state, when, interval)
    with pytest.raises(ValueError):
        journal.probe_status(datetime(2026, 11, 20))
    assert journal.probe_status()["freshness"] == "never_observed"


def test_older_probe_cannot_overwrite_newer_observation_from_another_instance(tmp_path):
    path = tmp_path / "events.sqlite3"
    observed = datetime.now(UTC)
    latest = WatchdogHistory(path)
    delayed = WatchdogHistory(path)
    latest.record_probe("ready", observed, 30)

    # A delayed writer must not report stale/unreachable data as newest.
    with pytest.raises(ValueError, match="Out-of-order"):
        delayed.record_probe("unreachable", observed - timedelta(seconds=60), 30)
    result = WatchdogHistory(path).probe_status(observed + timedelta(seconds=1))
    assert result["last_observed_state"] == "ready"
    assert result["last_checked_at"] == observed.isoformat()
    assert result["freshness"] == "recent"
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM watchdog_latest_probe").fetchone()[0] == 1

    # A valid later probe from the delayed process is still accepted.
    delayed.record_probe("degraded", observed + timedelta(seconds=2), 30)
    assert (
        WatchdogHistory(path).probe_status(observed + timedelta(seconds=3))["last_observed_state"]
        == "degraded"
    )


def test_older_transition_does_not_rewrite_observed_incident_order(tmp_path):
    path = tmp_path / "events.sqlite3"
    observed = datetime.now(UTC)
    first = WatchdogHistory(path)
    delayed = WatchdogHistory(path)
    assert first.append_transition("unreachable", observed) is True
    assert first.append_transition("ready", observed + timedelta(seconds=10)) is True
    with pytest.raises(ValueError, match="Out-of-order"):
        delayed.append_transition("degraded", observed + timedelta(seconds=5))
    assert [event["state"] for event in WatchdogHistory(path).recent()] == [
        "unreachable",
        "ready",
    ]
    assert delayed.append_transition("degraded", observed + timedelta(seconds=11)) is True
    assert [event["state"] for event in WatchdogHistory(path).recent()] == [
        "unreachable",
        "ready",
        "degraded",
    ]


def test_corrupt_saved_probe_timestamp_fails_closed_without_overwrite(tmp_path):
    path = tmp_path / "events.sqlite3"
    journal = WatchdogHistory(path)
    moment = datetime.now(UTC)
    journal.record_probe("ready", moment, 30)
    with sqlite3.connect(path) as connection:
        connection.execute(
            "UPDATE watchdog_latest_probe SET checked_at = 'not-a-timestamp' WHERE id = 1"
        )
    with pytest.raises(ValueError, match="Invalid saved probe timestamp"):
        journal.record_probe("degraded", moment + timedelta(seconds=1), 30)
    with sqlite3.connect(path) as connection:
        assert connection.execute(
            "SELECT state, checked_at FROM watchdog_latest_probe WHERE id = 1"
        ).fetchone() == ("ready", "not-a-timestamp")


def test_monitor_keeps_freshness_current_with_no_new_transition(tmp_path):
    path = tmp_path / "events.sqlite3"
    observed = []
    for _ in range(2):
        assert (
            monitor(
                TARGET,
                30,
                once=True,
                probe=lambda _target: "ready",
                emit=observed.append,
                journal=WatchdogHistory(path),
            )
            == 0
        )
    assert len(observed) == 1
    assert WatchdogHistory(path).probe_status()["freshness"] == "recent"
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM watchdog_latest_probe").fetchone()[0] == 1
