"""Synthetic incident grouping without false downtime or uptime claims."""

import json
from datetime import UTC, datetime, timedelta

import pytest

import app.workers.independent_service_watchdog as watchdog
from app.workers.watchdog_history import WatchdogHistory
from app.workers.watchdog_incidents import summarize_incidents

ENV = {"APP_ENV": "test", "BODYVISION_ENABLE_WATCHDOG": "synthetic-only"}


def events(*states: str) -> list[dict[str, str]]:
    start = datetime.now(UTC) - timedelta(minutes=20)
    return [
        {
            "event": "synthetic_watchdog_transition",
            "state": state,
            "checked_at": (start + timedelta(seconds=index * 15)).isoformat(),
        }
        for index, state in enumerate(states)
    ]


def test_healthy_and_empty_history_do_not_invent_incidents_or_availability():
    empty = summarize_incidents([])
    assert empty == {
        "event": "synthetic_watchdog_incident_report",
        "coverage": "transitions_only_no_uptime_estimate",
        "last_observed_state": None,
        "episode_count": 0,
        "recoveries_observed": 0,
        "episodes": [],
    }
    healthy = summarize_incidents(events("ready"))
    assert healthy["episode_count"] == 0
    assert healthy["last_observed_state"] == "ready"
    assert "availability_percent" not in json.dumps(healthy)


def test_degradation_and_connection_failure_form_one_observed_episode():
    report = summarize_incidents(events("ready", "degraded", "unreachable", "ready"))
    assert report["episode_count"] == 1
    assert report["recoveries_observed"] == 1
    assert report["last_observed_state"] == "ready"
    episode = report["episodes"][0]
    assert episode["first_nonready_state"] == "degraded"
    assert episode["last_nonready_state"] == "unreachable"
    assert episode["outcome"] == "recovery_observed"
    assert episode["seconds_between_observations"] == 30
    assert episode["recovery_observed_at"] is not None
    assert "patient" not in json.dumps(report)


def test_unrecovered_observation_does_not_assume_current_outage_duration():
    report = summarize_incidents(events("unreachable", "degraded"))
    assert report["episode_count"] == 1
    assert report["recoveries_observed"] == 0
    assert report["episodes"][0]["outcome"] == "recovery_not_observed"
    assert report["episodes"][0]["recovery_observed_at"] is None
    assert report["episodes"][0]["seconds_between_observations"] is None


def test_multiple_episodes_and_journal_truncation_do_not_infer_unknown_history():
    report = summarize_incidents(events("unreachable", "ready", "degraded", "ready"))
    assert report["episode_count"] == 2
    assert report["recoveries_observed"] == 2
    assert [item["seconds_between_observations"] for item in report["episodes"]] == [
        15,
        15,
    ]
    report = summarize_incidents(events("ready", "unreachable"))
    assert report["episode_count"] == 1
    assert report["episodes"][0]["outcome"] == "recovery_not_observed"


def test_untrusted_states_timestamps_and_order_fail_closed():
    sample = events("ready", "unreachable")
    for broken in (
        [{**sample[0], "state": "patient-secret"}],
        [{**sample[0], "event": "unknown"}],
        [{**sample[0], "user_id": "someone"}],
        [{**sample[0], "checked_at": "not a date"}],
        [{**sample[0], "checked_at": "2026-11-20T08:00:00"}],
        [sample[1], sample[0]],
    ):
        with pytest.raises(ValueError):
            summarize_incidents(broken)


def test_cli_requires_explicit_authorization_and_reads_only_local_journal(
    tmp_path, monkeypatch, capsys
):
    path = tmp_path / "events.sqlite3"
    journal = WatchdogHistory(path)
    now = datetime.now(UTC) - timedelta(minutes=3)
    journal.append_transition("unreachable", now)
    journal.append_transition("ready", now + timedelta(seconds=20))
    monkeypatch.setattr(watchdog, "WatchdogHistory", lambda: WatchdogHistory(path))

    assert watchdog.main(["--incidents"], ENV) == 0
    output = json.loads(capsys.readouterr().out)
    assert output["episode_count"] == 1
    assert output["recoveries_observed"] == 1
    assert output["episodes"][0]["seconds_between_observations"] == 20
    assert output["coverage"] == "transitions_only_no_uptime_estimate"

    assert watchdog.main(["--incidents"], {**ENV, "APP_ENV": "production"}) == 2
    assert capsys.readouterr().out.strip() == '{"event":"synthetic_watchdog_disabled"}'


def test_cli_damaged_journal_fails_closed_without_database_error_details(
    tmp_path, monkeypatch, capsys
):
    bad = tmp_path / "damaged.sqlite3"
    bad.write_bytes(b"no sqlite content with secret")
    monkeypatch.setattr(watchdog, "WatchdogHistory", lambda: WatchdogHistory(bad))
    assert watchdog.main(["--incidents"], ENV) == 3
    assert capsys.readouterr().out.strip() == (
        '{"event":"synthetic_watchdog_journal_unavailable"}'
    )
