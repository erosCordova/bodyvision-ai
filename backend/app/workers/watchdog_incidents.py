"""Privacy-minimized incident episodes from synthetic local watchdog transitions.

This is not an uptime calculator: transitions have no regular heartbeat,
and time between observations is not actual outage duration.
"""

from datetime import datetime

STATES = frozenset({"ready", "degraded", "unreachable"})


def summarize_incidents(events: list[dict[str, str]]) -> dict[str, object]:
    episodes: list[dict[str, object]] = []
    pending: dict[str, object] | None = None
    previous_time: datetime | None = None
    last_state: str | None = None

    for entry in events:
        if set(entry) != {"event", "state", "checked_at"}:
            raise ValueError("Unrecognized local observation")
        if entry["event"] != "synthetic_watchdog_transition":
            raise ValueError("Unrecognized local observation")
        state = entry["state"]
        if state not in STATES:
            raise ValueError("Unrecognized local observation")
        timestamp = datetime.fromisoformat(entry["checked_at"])
        if timestamp.tzinfo is None or (previous_time is not None and timestamp < previous_time):
            raise ValueError("Unordered or timezone-free observation")
        previous_time = timestamp
        last_state = state

        if state != "ready":
            if pending is None:
                pending = {
                    "first_nonready_state": state,
                    "last_nonready_state": state,
                    "first_observed_at": timestamp.isoformat(),
                    "recovery_observed_at": None,
                    "seconds_between_observations": None,
                    "outcome": "recovery_not_observed",
                }
                episodes.append(pending)
            else:
                pending["last_nonready_state"] = state
        elif pending is not None:
            first = datetime.fromisoformat(str(pending["first_observed_at"]))
            pending["recovery_observed_at"] = timestamp.isoformat()
            pending["seconds_between_observations"] = round((timestamp - first).total_seconds(), 3)
            pending["outcome"] = "recovery_observed"
            pending = None

    return {
        "event": "synthetic_watchdog_incident_report",
        "coverage": "transitions_only_no_uptime_estimate",
        "last_observed_state": last_state,
        "episode_count": len(episodes),
        "recoveries_observed": sum(item["outcome"] == "recovery_observed" for item in episodes),
        "episodes": episodes,
    }
