"""Bounded retention cleanup must be safe, resumable and private."""

from unittest.mock import MagicMock

import pytest

from app.workers.capture_retention import purge_due, purge_due_pose_summaries


def fake_engine(batch_results):
    engine = MagicMock()
    connection = engine.begin.return_value.__enter__.return_value
    connection.execute.return_value.scalar_one.side_effect = batch_results
    return engine, connection


def test_expired_captures_are_deleted_in_bounded_batches():
    engine, connection = fake_engine([100, 100, 17])
    assert purge_due(engine, batch_size=100, max_batches=10) == 217
    assert connection.execute.call_count == 3
    for call in connection.execute.call_args_list:
        assert call.args[1] == {"batch": 100}


def test_full_batches_stop_at_budget_and_resume_on_next_run():
    engine, connection = fake_engine([5, 5])
    assert purge_due(engine, batch_size=5, max_batches=2) == 10
    assert connection.execute.call_count == 2


@pytest.mark.parametrize(
    "batch_size,max_batches",
    [
        (0, 10),
        (101, 10),
        (10, 0),
        (10, 101),
    ],
)
def test_unbounded_or_empty_purge_is_rejected(batch_size, max_batches):
    engine = MagicMock()
    with pytest.raises(ValueError, match="bounded"):
        purge_due(engine, batch_size=batch_size, max_batches=max_batches)
    engine.begin.assert_not_called()


def test_retention_failure_does_not_report_uncommitted_deletions():
    engine = MagicMock()
    connection = engine.begin.return_value.__enter__.return_value
    connection.execute.side_effect = RuntimeError("database unavailable")
    with pytest.raises(RuntimeError, match="database unavailable"):
        purge_due(engine)


def test_expired_pose_summaries_are_purged_in_bounded_batches():
    engine, connection = fake_engine([100, 3])
    assert purge_due_pose_summaries(engine, batch_size=100, max_batches=10) == 103
    assert connection.execute.call_count == 2
    for call in connection.execute.call_args_list:
        assert call.args[1] == {"batch": 100}


@pytest.mark.parametrize("batch_size,max_batches", [(0, 1), (101, 1), (5, 0), (5, 101)])
def test_unbounded_pose_retention_is_rejected(batch_size, max_batches):
    engine = MagicMock()
    with pytest.raises(ValueError, match="bounded"):
        purge_due_pose_summaries(engine, batch_size=batch_size, max_batches=max_batches)
    engine.begin.assert_not_called()
