"""Bounded process-local telemetry. Verified tenant keys never leave this collector."""

import math
import threading
import time
from collections import OrderedDict, deque
from datetime import UTC, datetime
from uuid import UUID

WINDOW_SECONDS = 300
MAX_SAMPLES = 256
MAX_ORGANIZATIONS = 64


class OperationsMetrics:
    def __init__(self, *, clock=time.monotonic, retention_enabled=False, retention_interval=900):
        self._clock = clock
        self._started = clock()
        self._lock = threading.Lock()
        self._samples: OrderedDict[UUID, deque] = OrderedDict()
        self._retention_enabled = retention_enabled
        self._retention_interval = retention_interval
        self._retention_result: tuple[float, str, str] | None = None

    def observe(self, organization: UUID, status: int, duration_ms: float, *, interrupted=False):
        if not isinstance(organization, UUID) or not 100 <= status <= 599:
            return
        if not math.isfinite(duration_ms) or duration_ms < 0:
            return
        now = self._clock()
        with self._lock:
            self._prune(now)
            if organization not in self._samples:
                if len(self._samples) >= MAX_ORGANIZATIONS:
                    self._samples.popitem(last=False)
                self._samples[organization] = deque(maxlen=MAX_SAMPLES)
            self._samples[organization].append((now, status, duration_ms, bool(interrupted)))
            self._samples.move_to_end(organization)

    def _prune(self, now):
        for organization in list(self._samples):
            rows = self._samples[organization]
            while rows and now - rows[0][0] >= WINDOW_SECONDS:
                rows.popleft()
            if not rows:
                del self._samples[organization]

    def retention_completed(self, success: bool):
        with self._lock:
            self._retention_result = (
                self._clock(),
                "ready" if success else "failed",
                datetime.now(UTC).isoformat(),
            )

    def snapshot(self, organization: UUID) -> dict:
        now = self._clock()
        with self._lock:
            self._prune(now)
            rows = list(self._samples.get(organization, ()))
            retention = self._retention_result
        count = len(rows)
        durations = sorted(row[2] for row in rows)
        errors = sum(row[1] >= 500 for row in rows)
        timeouts = sum(row[3] for row in rows)
        p95 = round(durations[math.ceil(count * 0.95) - 1], 2) if count else None
        alerts = []
        if errors >= 3 or (count >= 5 and errors / count >= 0.2):
            alerts.append("server_failures")
        if timeouts:
            alerts.append("query_interrupted")
        if count >= 5 and p95 is not None and p95 >= 2000:
            alerts.append("slow_responses")
        state, checked_at = "disabled", None
        if self._retention_enabled:
            state = "pending"
            age = now - self._started
            if retention:
                age, state, checked_at = now - retention[0], retention[1], retention[2]
            if age >= self._retention_interval * 2:
                state = "overdue"
            if state in {"failed", "overdue"}:
                alerts.append("retention_" + state)
        return {
            "scope": "current_organization_current_process",
            "checked_at": datetime.now(UTC).isoformat(),
            "uptime_seconds": max(0, round(now - self._started)),
            "window_seconds": WINDOW_SECONDS,
            "sample_limit": MAX_SAMPLES,
            "sample_count": count,
            "successes": sum(200 <= row[1] < 400 for row in rows),
            "client_errors": sum(400 <= row[1] < 500 for row in rows),
            "server_errors": errors,
            "query_interruptions": timeouts,
            "p95_ms": p95,
            "retention": {"state": state, "checked_at": checked_at},
            "alerts": alerts,
        }
