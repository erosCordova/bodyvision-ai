import asyncio
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4

import pytest

from app.core.operations import MAX_ORGANIZATIONS, MAX_SAMPLES, OperationsMetrics
from app.workers.capture_retention import retention_loop


class Clock:
    now = 0.0

    def __call__(self):
        return self.now


def test_recent_samples_and_alerts_are_tenant_scoped_and_expire():
    clock = Clock()
    metrics = OperationsMetrics(clock=clock)
    first, second = uuid4(), uuid4()
    for duration, status in [(10, 200), (20, 201), (30, 403), (50, 200), (3000, 500)]:
        metrics.observe(first, status, duration)
    metrics.observe(second, 200, 8)
    result = metrics.snapshot(first)
    assert result["sample_count"] == 5
    assert (result["successes"], result["client_errors"], result["server_errors"]) == (3, 1, 1)
    assert result["p95_ms"] == 3000
    assert result["alerts"] == ["server_failures", "slow_responses"]
    other = metrics.snapshot(second)
    assert other["sample_count"] == 1 and other["p95_ms"] == 8
    assert other["alerts"] == []
    assert str(first) not in str(result) and str(second) not in str(result)
    clock.now = 300
    expired = metrics.snapshot(first)
    assert expired["sample_count"] == 0 and expired["p95_ms"] is None
    assert expired["alerts"] == []


def test_sample_and_organization_memory_is_bounded_under_concurrent_writes():
    metrics = OperationsMetrics()
    organization = uuid4()
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda _: metrics.observe(organization, 200, 1), range(1024)))
    assert metrics.snapshot(organization)["sample_count"] == MAX_SAMPLES
    # Most recently observed organization stays; old buckets can be evicted.
    for _ in range(MAX_ORGANIZATIONS):
        metrics.observe(uuid4(), 200, 1)
    assert metrics.snapshot(organization)["sample_count"] == 0


def test_timeouts_small_samples_and_client_rejections_have_distinct_alerts():
    metrics = OperationsMetrics()
    organization = uuid4()
    metrics.observe(organization, 500, 3000, interrupted=True)
    assert metrics.snapshot(organization)["alerts"] == ["query_interrupted"]
    other = uuid4()
    for _ in range(10):
        metrics.observe(other, 403, 1)
    assert metrics.snapshot(other)["alerts"] == []
    for duration in [float("nan"), float("inf"), -1]:
        metrics.observe(other, 200, duration)
    metrics.observe(UUID(int=0), 999, 10)
    assert metrics.snapshot(other)["sample_count"] == 10


def test_retention_observation_tracks_failure_overdue_and_recovery_without_counts():
    clock = Clock()
    metrics = OperationsMetrics(clock=clock, retention_enabled=True, retention_interval=60)
    organization = uuid4()
    assert metrics.snapshot(organization)["retention"]["state"] == "pending"
    metrics.retention_completed(False)
    assert metrics.snapshot(organization)["alerts"] == ["retention_failed"]
    clock.now = 120
    assert metrics.snapshot(organization)["alerts"] == ["retention_overdue"]
    metrics.retention_completed(True)
    assert metrics.snapshot(organization)["retention"]["state"] == "ready"
    assert metrics.snapshot(organization)["alerts"] == []
    assert OperationsMetrics().snapshot(organization)["retention"]["state"] == "disabled"


def test_retention_loop_reports_failure_then_recovery(monkeypatch):
    metrics = OperationsMetrics(retention_enabled=True)
    organization = uuid4()
    runs = 0
    states = []

    async def run_once(*args):
        nonlocal runs
        runs += 1
        if runs == 1:
            raise RuntimeError("sensitive SQL must never be exported")
        return 7

    async def next_interval(*args):
        states.append(metrics.snapshot(organization)["retention"]["state"])
        if runs == 2:
            raise asyncio.CancelledError

    monkeypatch.setattr("app.workers.capture_retention.asyncio.to_thread", run_once)
    monkeypatch.setattr("app.workers.capture_retention.asyncio.sleep", next_interval)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(retention_loop(None, 60, metrics))
    assert states == ["failed", "ready"]
    assert "sensitive" not in str(metrics.snapshot(organization))
