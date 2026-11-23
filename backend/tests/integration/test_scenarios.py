"""Real PostgreSQL tests for isolated, immutable synthetic scenario versions."""

import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import IntegrityError, ProgrammingError

from app.core.config import Settings
from app.main import create_app
from app.models.context import FIRST_WORKSPACE, SECOND_WORKSPACE


@pytest.fixture
def db_url():
    value = os.environ.get("TEST_DATABASE_URL")
    if not value:
        pytest.skip("Real PostgreSQL required")
    return value


@pytest.fixture
def database(db_url):
    engine = create_engine(db_url)
    yield engine
    engine.dispose()


@pytest.fixture
def client(db_url):
    engine = create_engine(db_url, hide_parameters=True)

    @event.listens_for(engine, "connect")
    def limited_role(connection, record):
        connection.execute("SET ROLE bodyvision_app")

    with TestClient(create_app(Settings(app_env="test", database_url=db_url), engine)) as api:
        yield api


def new_profile(client, org=FIRST_WORKSPACE):
    result = client.post(
        "/api/v1/profiles",
        json={"birth_year": 1997, "display_name": "Cuerpo ficticio"},
        headers={"X-Workspace-ID": str(org)},
    )
    assert result.status_code == 201, result.text
    return result.json()["id"]


def scenario(client, profile_id, data=None, org=FIRST_WORKSPACE, key=None):
    return client.post(
        f"/api/v1/profiles/{profile_id}/scenarios",
        json=data or {"reference_kg": 70, "variation_percent": 20, "stature_cm": 180},
        headers={"X-Workspace-ID": str(org), "Idempotency-Key": str(key or uuid4())},
    )


def test_append_only_version_chain_and_separation_from_observed(client, database):
    profile = new_profile(client)
    baseline = scenario(client, profile)
    assert baseline.status_code == 201, baseline.text
    first = baseline.json()
    assert first["data_type"] == "SIMULADO"
    assert first["version"] == 1
    assert first["series_id"] == first["id"]
    assert first["prior_version_id"] is None
    assert first["simulated_kg"] == 84
    assert len(first["model_revision"]) == 40
    assert first["algorithm_revision"] == "regional-soft-tissue-v2"

    changed = scenario(
        client,
        profile,
        {
            "reference_kg": 70,
            "variation_percent": -15,
            "stature_cm": 175,
            "prior_version_id": first["id"],
            "revision_note": "Explorar volumen menor",
        },
    )
    assert changed.status_code == 201, changed.text
    second = changed.json()
    assert second["data_type"] == "SIMULADO"
    assert second["series_id"] == first["series_id"]
    assert second["version"] == 2
    assert second["simulated_kg"] == 59.5
    history = client.get(f"/api/v1/profiles/{profile}/scenarios/{second['id']}/versions")
    assert history.status_code == 200
    assert [row["version"] for row in history.json()] == [1, 2]
    recent = client.get(f"/api/v1/profiles/{profile}/scenarios")
    assert recent.status_code == 200
    assert recent.json()["total"] == 2
    assert {row["data_type"] for row in recent.json()["items"]} == {"SIMULADO"}
    observed = client.get(f"/api/v1/profiles/{profile}/measurements")
    assert observed.status_code == 200
    assert observed.json()["total"] == 0
    assert client.get(f"/api/v1/profiles/{profile}/analytics/series?period=all").json() == []
    with database.connect() as conn:
        assert (
            conn.execute(
                text("SELECT count(*) FROM measurements WHERE profile_id=:id"),
                {"id": profile},
            ).scalar_one()
            == 0
        )


@pytest.mark.parametrize(
    ("revision_name", "old_revision"),
    [
        ("ATLAS_REVISION", "0" * 40),
        ("ALGORITHM_REVISION", "regional-soft-tissue-v1"),
    ],
)
def test_append_only_chain_rejects_legacy_engine_without_modifying_history(
    client,
    monkeypatch,
    revision_name,
    old_revision,
):
    from app.api.routes import simulation_scenarios as scenario_routes

    profile_id = new_profile(client)
    expected_revision = getattr(scenario_routes, revision_name)
    try:
        # Construct a legitimate historical root while the fictitious CI
        # application uses a previous model/algorithm. Do not edit the
        # immutable database record or bypass triggers.
        monkeypatch.setattr(scenario_routes, revision_name, old_revision)
        old = scenario(client, profile_id)
        assert old.status_code == 201, old.text
        old_root = old.json()
    finally:
        monkeypatch.setattr(scenario_routes, revision_name, expected_revision)

    update = {
        "reference_kg": 75,
        "variation_percent": 10,
        "stature_cm": 185,
        "prior_version_id": old_root["id"],
        "revision_note": "Actualizar modelo ilustrativo",
    }
    rejected = scenario(client, profile_id, update)
    assert rejected.status_code == 409, rejected.text
    assert rejected.json()["code"] == "SCENARIO_ENGINE_MISMATCH"

    # The old revision and its provenance remain readable for audit;
    # neither an observation nor a partial successor can be created.
    all_versions = client.get(f"/api/v1/profiles/{profile_id}/scenarios")
    assert all_versions.status_code == 200
    assert all_versions.json()["total"] == 1
    old_record = all_versions.json()["items"][0]
    assert old_record["id"] == old_root["id"]
    assert old_record["model_revision"] == old_root["model_revision"]
    assert old_record["algorithm_revision"] == old_root["algorithm_revision"]
    assert client.get(f"/api/v1/profiles/{profile_id}/measurements").json()["total"] == 0

    # Starting a fresh series is permitted, then its descendants can be
    # appended under the *same* pinned revision.
    new_root = scenario(client, profile_id)
    assert new_root.status_code == 201, new_root.text
    current = new_root.json()
    assert current["series_id"] != old_root["series_id"]
    next_data = {**update, "prior_version_id": current["id"]}
    successor = scenario(client, profile_id, next_data)
    assert successor.status_code == 201, successor.text
    assert successor.json()["series_id"] == current["series_id"]
    assert successor.json()["version"] == 2
    assert client.get(f"/api/v1/profiles/{profile_id}/scenarios").json()["total"] == 3



def test_paginated_history_uses_fixed_utc_high_watermark_across_new_version(client):
    """A later committed insert must not shift the in-progress CSV pages."""
    profile = new_profile(client)
    created = [scenario(client, profile).json()["id"] for _ in range(3)]
    url = f"/api/v1/profiles/{profile}/scenarios"
    previous = client.get(url, params={"limit": 20})
    assert previous.status_code == 200, previous.text
    assert set(row["id"] for row in previous.json()["items"]) == set(created)

    first = client.get(url, params={"limit": 2, "offset": 0})
    assert first.status_code == 200, first.text
    first_page = first.json()
    assert first_page["total"] == 3
    assert first_page["snapshot_at"] is not None
    # Another request appends a fourth immutable synthetic version.
    new_id = scenario(client, profile).json()["id"]
    second = client.get(
        url, params={"limit": 2, "offset": 2, "snapshot_at": first_page["snapshot_at"]}
    )
    assert second.status_code == 200, second.text
    second_page = second.json()
    assert second_page["snapshot_at"] == first_page["snapshot_at"]
    assert second_page["total"] == 3
    collected = [row["id"] for row in first_page["items"] + second_page["items"]]
    assert len(collected) == 3
    assert set(collected) == set(created)
    assert new_id not in collected

    # Ordinary browsing sees the new row. The snapshot is not persisted.
    fresh = client.get(url, params={"limit": 20})
    assert fresh.status_code == 200
    assert fresh.json()["total"] == 4
    assert new_id in {row["id"] for row in fresh.json()["items"]}


@pytest.mark.parametrize(
    "provided",
    [
        "2026-11-20T13:00:00",
        "2099-01-01T00:00:00Z",
        "2000-01-01T00:00:00Z",
    ],
)
def test_paginated_history_rejects_unsafe_snapshot_without_data(client, provided):
    profile = new_profile(client)
    assert scenario(client, profile).status_code == 201
    response = client.get(
        f"/api/v1/profiles/{profile}/scenarios",
        params={"limit": 20, "offset": 0, "snapshot_at": provided},
    )
    assert response.status_code == 422
    assert "items" not in response.json()



def test_exactly_once_save_and_reject_stale_chain(client):
    profile = new_profile(client)
    data = {"reference_kg": 70, "variation_percent": 20, "stature_cm": 180}
    key = uuid4()
    first = scenario(client, profile, data, key=key)
    assert first.status_code == 201, first.text
    assert scenario(client, profile, data, key=key).json()["id"] == first.json()["id"]
    changed = {**data, "variation_percent": 21}
    assert scenario(client, profile, changed, key=key).status_code == 409
    revised = {
        **data,
        "prior_version_id": first.json()["id"],
        "revision_note": "Nuevo escenario ficticio",
    }
    assert scenario(client, profile, revised).status_code == 201
    stale = scenario(client, profile, revised)
    assert stale.status_code == 409
    assert stale.json()["code"] == "SCENARIO_VERSION_CONFLICT"
    assert client.get(f"/api/v1/profiles/{profile}/scenarios").json()["total"] == 2


def test_invalid_inputs_and_archived_profile_are_rejected(client):
    profile = new_profile(client)
    invalid = [
        {"reference_kg": 39, "variation_percent": 0, "stature_cm": 175},
        {"reference_kg": 70, "variation_percent": 31, "stature_cm": 175},
        {"reference_kg": 70, "variation_percent": 0, "stature_cm": 206},
        {
            "reference_kg": 70,
            "variation_percent": 0,
            "stature_cm": 175,
            "prior_version_id": str(uuid4()),
            "revision_note": "Motivo real",
        },
        {
            "reference_kg": 70,
            "variation_percent": 0,
            "stature_cm": 175,
            "revision_note": "Sin versión previa",
        },
        {"reference_kg": "NaN", "variation_percent": 0, "stature_cm": 175},
    ]
    for data in invalid:
        assert scenario(client, profile, data).status_code in {404, 422}
    assert (
        scenario(
            client,
            profile,
            {"reference_kg": 70, "variation_percent": 0, "stature_cm": 175},
            key=None,
        ).status_code
        == 201
    )
    archived = client.post(f"/api/v1/profiles/{profile}/archive")
    assert archived.status_code == 200
    assert scenario(client, profile).status_code == 409
    assert client.get(f"/api/v1/profiles/{profile}/scenarios").status_code == 200


def test_cross_workspace_and_actual_row_level_security(client, db_url):
    profile = new_profile(client, SECOND_WORKSPACE)
    created = scenario(client, profile, org=SECOND_WORKSPACE)
    assert created.status_code == 201, created.text
    scenario_id = created.json()["id"]
    assert client.get(f"/api/v1/profiles/{profile}/scenarios").status_code == 404
    assert (
        client.get(f"/api/v1/profiles/{profile}/scenarios/{scenario_id}/versions").status_code
        == 404
    )
    assert scenario(client, profile).status_code == 404

    engine = create_engine(db_url)
    try:
        with engine.connect() as conn:
            transaction = conn.begin()
            conn.execute(text("SET LOCAL ROLE bodyvision_app"))
            conn.execute(
                text("SELECT set_config('app.organization_id',:id,true)"),
                {"id": str(FIRST_WORKSPACE)},
            )
            assert (
                conn.execute(
                    text("SELECT count(*) FROM simulation_scenarios WHERE id=:id"),
                    {"id": scenario_id},
                ).scalar_one()
                == 0
            )
            with pytest.raises(ProgrammingError):
                conn.execute(
                    text("UPDATE simulation_scenarios SET stature_cm=180 WHERE id=:id"),
                    {"id": scenario_id},
                )
            transaction.rollback()
    finally:
        engine.dispose()


def test_immutability_triggers_reject_owner_updates_deletes(client, database):
    profile = new_profile(client)
    scenario_id = scenario(client, profile).json()["id"]
    with database.begin() as conn:
        with pytest.raises(IntegrityError):
            conn.execute(
                text("UPDATE simulation_scenarios SET stature_cm=190 WHERE id=:id"),
                {"id": scenario_id},
            )
    with database.begin() as conn:
        with pytest.raises(IntegrityError):
            conn.execute(
                text("DELETE FROM simulation_scenarios WHERE id=:id"),
                {"id": scenario_id},
            )


def test_public_demo_cannot_save_synthetic_scenarios(db_url):
    engine = create_engine(db_url)
    with TestClient(create_app(Settings(app_env="demo", database_url=db_url), engine)) as api:
        result = api.post(
            f"/api/v1/profiles/{uuid4()}/scenarios",
            json={"reference_kg": 70, "variation_percent": 0, "stature_cm": 175},
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert result.status_code == 403
        assert result.json()["code"] == "DEMO_READ_ONLY"
