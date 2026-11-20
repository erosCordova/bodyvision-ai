"""An opt-in maintenance process must not access remote or private data."""

from unittest.mock import MagicMock, patch

import pytest

from app.workers.independent_capture_retention import (
    IndependentRetentionDenied,
    require_synthetic_retention,
    run_once,
)

GOOD = {
    "APP_ENV": "test",
    "IDENTITY_ENABLED": "true",
    "BODYVISION_ENABLE_CAPTURE_RETENTION": "synthetic-only",
    "DATABASE_URL": "postgresql+psycopg://bodyvision_app:synthetic@127.0.0.1/bodyvision",
}


@pytest.mark.parametrize(
    ("change", "url"),
    [
        ({"APP_ENV": "production"}, None),
        ({"APP_ENV": "demo"}, None),
        ({"APP_ENV": "staging"}, None),
        ({"IDENTITY_ENABLED": "false"}, None),
        ({"BODYVISION_ENABLE_CAPTURE_RETENTION": "disabled"}, None),
        ({}, "postgresql+psycopg://postgres@localhost/bodyvision"),
        ({}, "postgresql+psycopg://bodyvision_auth_app@localhost/bodyvision"),
        ({}, "postgresql+psycopg://bodyvision_app@neon.tech/bodyvision"),
        ({}, "postgresql+psycopg://bodyvision_app@db-test/bodyvision_test"),
        ({}, "sqlite:///local.db"),
        ({}, "not-a-connection-string"),
    ],
)
def test_sidecar_refuses_unauthorized_environment_and_remote_hosts(change, url):
    environment = {**GOOD, **change}
    if url is not None:
        environment["DATABASE_URL"] = url
    with pytest.raises(IndependentRetentionDenied):
        require_synthetic_retention(environment)


@pytest.mark.parametrize("interval", ["0", "59", "86401", "bad"])
def test_sidecar_rejects_unbounded_or_invalid_intervals(interval):
    with pytest.raises(IndependentRetentionDenied):
        require_synthetic_retention({**GOOD, "CAPTURE_RETENTION_INTERVAL_SECONDS": interval})


def test_single_pass_checks_real_data_role_and_disposes_engine():
    engine = MagicMock()
    connection = engine.connect.return_value.__enter__.return_value
    connection.execute.return_value.scalar_one.return_value = "bodyvision_app"
    with (
        patch(
            "app.workers.independent_capture_retention.create_engine",
            return_value=engine,
        ) as creator,
        patch(
            "app.workers.independent_capture_retention.purge_due",
            return_value=3,
        ) as cleanup,
    ):
        assert run_once(GOOD) == 3
    cleanup.assert_called_once_with(engine, batch_size=100, max_batches=10)
    assert creator.call_args.kwargs["hide_parameters"] is True
    assert creator.call_args.kwargs["connect_args"]["connect_timeout"] == 3
    engine.dispose.assert_called_once()


def test_sidecar_rejects_unexpected_database_role_before_deleting():
    engine = MagicMock()
    connection = engine.connect.return_value.__enter__.return_value
    connection.execute.return_value.scalar_one.return_value = "postgres"
    with (
        patch("app.workers.independent_capture_retention.create_engine", return_value=engine),
        patch("app.workers.independent_capture_retention.purge_due") as cleanup,
    ):
        with pytest.raises(IndependentRetentionDenied, match="Rol"):
            run_once(GOOD)
    cleanup.assert_not_called()
    engine.dispose.assert_called_once()
