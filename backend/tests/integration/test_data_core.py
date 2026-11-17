import os
from datetime import UTC, datetime, timedelta
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
        pytest.skip("Real PostgreSQL is required")
    return value


@pytest.fixture
def database(db_url):
    engine = create_engine(db_url)
    yield engine
    engine.dispose()


@pytest.fixture
def app_engine(db_url):
    engine = create_engine(db_url, hide_parameters=True)

    @event.listens_for(engine, "connect")
    def limited_role(connection, record):
        connection.execute("SET ROLE bodyvision_app")

    yield engine
    engine.dispose()


@pytest.fixture
def client(db_url, app_engine):
    with TestClient(
        create_app(Settings(app_env="test", database_url=db_url), app_engine)
    ) as client:
        yield client


def new_profile(client, org=FIRST_WORKSPACE):
    response = client.post(
        "/api/v1/profiles",
        json={"birth_year": 1995, "display_name": "Caso ficticio"},
        headers={"X-Workspace-ID": str(org)},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def entry(value=70, metric="weight", unit="kg", at=None, **extra):
    return dict(
        metric_code=metric,
        value=value,
        unit=unit,
        method="manual",
        measured_at=(at or datetime.now(UTC) - timedelta(minutes=1)).isoformat(),
        **extra,
    )


def post(client, profile, data, key=None, org=FIRST_WORKSPACE):
    return client.post(
        f"/api/v1/profiles/{profile}/measurements",
        json=data,
        headers={"X-Workspace-ID": str(org), "Idempotency-Key": str(key or uuid4())},
    )


def test_workspace_catalog_and_pagination(client):
    assert len(client.get("/api/v1/workspaces").json()["items"]) == 2
    assert len(client.get("/api/v1/metrics/catalog").json()) == 10
    new_profile(client)
    result = client.get("/api/v1/profiles?limit=1").json()
    assert len(result["items"]) == 1 and result["total"] >= 1
    assert client.get("/api/v1/profiles?limit=101").status_code == 422


@pytest.mark.parametrize(
    "change",
    [
        {"value": 0},
        {"value": 501},
        {"unit": "lb"},
        {"method": "visual_estimate"},
        {"value": 71.123},
        {"measured_at": (datetime.now(UTC) + timedelta(days=1)).isoformat()},
        {"metric_code": "body_fat_pct", "unit": "%"},
        {"method": "device"},
    ],
)
def test_observed_validation(client, change):
    profile = new_profile(client)
    assert post(client, profile, {**entry(), **change}).status_code == 422


def test_device_observation_and_sources(client):
    profile = new_profile(client)
    response = post(
        client,
        profile,
        {
            **entry(25, "body_fat_pct", "%"),
            "method": "device",
            "instrument": "Instrumento ficticio",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["data_type"] == "OBSERVADO"
    assert response.json()["responsible"] == "Operador ficticio 1"


def test_idempotency_retries_and_duplicates(client):
    profile = new_profile(client)
    data = entry()
    key = uuid4()
    first = post(client, profile, data, key)
    assert first.status_code == 201, first.text
    assert post(client, profile, data, key).json()["id"] == first.json()["id"]
    assert post(client, profile, {**data, "value": 71}, key).status_code == 409
    duplicate = post(client, profile, data)
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "DUPLICATE_CONFIRMATION_REQUIRED"
    assert post(client, profile, {**data, "duplicate_confirmed": True}).status_code == 201


def test_correction_preserves_values_and_history(client, database):
    profile = new_profile(client)
    data = entry()
    original = post(client, profile, data).json()
    response = client.patch(
        "/api/v1/measurements/" + original["id"],
        json={**data, "value": 69, "correction_reason": "Corrección ficticia"},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 201, response.text
    corrected = response.json()
    versions = client.get("/api/v1/measurements/" + original["id"] + "/versions").json()
    assert [x["value"] for x in versions] == [70, 69]
    assert [x["is_current"] for x in versions] == [False, True]
    assert corrected["supersedes_id"] == original["id"]
    current = client.get(f"/api/v1/profiles/{profile}/measurements").json()["items"]
    assert len(current) == 1 and current[0]["value"] == 69
    # A second direct correction of the old version conflicts.
    again = client.patch(
        "/api/v1/measurements/" + original["id"],
        json={**data, "value": 68, "correction_reason": "Otra corrección ficticia"},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert again.status_code == 409
    with database.begin() as conn:
        with pytest.raises(IntegrityError):
            conn.execute(
                text("UPDATE measurements SET value=80 WHERE id=:id"), {"id": corrected["id"]}
            )
    with database.begin() as conn:
        with pytest.raises(IntegrityError):
            conn.execute(text("DELETE FROM measurements WHERE id=:id"), {"id": corrected["id"]})


def test_outlier_requires_confirmation(client):
    profile = new_profile(client)
    assert (
        post(client, profile, entry(60, at=datetime.now(UTC) - timedelta(hours=12))).status_code
        == 201
    )
    data = entry(75)
    result = post(client, profile, data)
    assert result.status_code == 409 and result.json()["code"] == "OUTLIER_CONFIRMATION_REQUIRED"
    assert post(client, profile, {**data, "outlier_confirmed": True}).status_code == 201


def test_derived_has_formula_sources_and_missing_reasons(client):
    profile = new_profile(client)
    weight = post(client, profile, entry(72)).json()
    absent = client.get(f"/api/v1/profiles/{profile}/analytics/derived").json()
    assert absent[0]["value"] is None and absent[0]["reason"]
    height = post(client, profile, entry(180, "height", "cm")).json()
    output = client.get(f"/api/v1/profiles/{profile}/analytics/derived").json()[0]
    assert output["value"] == pytest.approx(22.222)
    assert set(output["source_measurement_ids"]) == {weight["id"], height["id"]}
    assert output["formula"] and output["data_type"] == "DERIVADO"


def test_waist_hip_requires_same_window(client):
    profile = new_profile(client)
    post(client, profile, entry(80, "waist", "cm", at=datetime.now(UTC) - timedelta(days=30)))
    post(client, profile, entry(100, "hip", "cm"))
    output = client.get(f"/api/v1/profiles/{profile}/analytics/derived").json()[1]
    assert output["value"] is None and "7 días" in output["reason"]


def test_cross_organization_api_and_actual_rls(client, app_engine):
    profile = new_profile(client, SECOND_WORKSPACE)
    measurement = post(client, profile, entry(), org=SECOND_WORKSPACE).json()
    for path in [
        f"/profiles/{profile}",
        f"/profiles/{profile}/measurements",
        f"/profiles/{profile}/analytics/derived",
        f"/profiles/{profile}/analytics/series",
        "/measurements/" + measurement["id"] + "/versions",
    ]:
        assert client.get("/api/v1" + path).status_code == 404, path
    with app_engine.begin() as conn:
        conn.execute(
            text("SELECT set_config('app.organization_id',:org,true)"),
            {"org": str(FIRST_WORKSPACE)},
        )
        assert (
            conn.execute(
                text("SELECT count(*) FROM profiles WHERE id=:id"), {"id": profile}
            ).scalar_one()
            == 0
        )
        assert (
            conn.execute(
                text("SELECT count(*) FROM measurements WHERE id=:id"), {"id": measurement["id"]}
            ).scalar_one()
            == 0
        )


def test_profile_access_revocation_hides_profile(client, database):
    profile = new_profile(client)
    with database.begin() as conn:
        conn.execute(text("DELETE FROM profile_access WHERE profile_id=:id"), {"id": profile})
    assert client.get("/api/v1/profiles/" + profile).status_code == 404
    assert post(client, profile, entry()).status_code == 404


def test_no_context_means_no_rows_in_database(client, app_engine):
    new_profile(client)
    with app_engine.begin() as conn:
        assert conn.execute(text("SELECT count(*) FROM profiles")).scalar_one() == 0
        with pytest.raises(ProgrammingError):
            conn.execute(text("UPDATE system_schema_state SET revision='tampered'"))


def test_archived_and_restricted_profiles_cannot_receive_measurements(client):
    profile = new_profile(client)
    assert (
        client.patch("/api/v1/profiles/" + profile, json={"status": "restricted"}).status_code
        == 200
    )
    assert post(client, profile, entry()).status_code == 409
    assert client.patch("/api/v1/profiles/" + profile, json={"status": "active"}).status_code == 200
    assert client.post("/api/v1/profiles/" + profile + "/archive").status_code == 200
    assert post(client, profile, entry()).status_code == 409


def test_series_only_observed_and_current(client):
    profile = new_profile(client)
    post(client, profile, entry())
    rows = client.get(f"/api/v1/profiles/{profile}/analytics/series?period=all").json()
    assert len(rows) == 1 and rows[0]["data_type"] == "OBSERVADO" and rows[0]["is_current"]
    assert client.get("/api/v1/dashboard/summary").json()["measurements_30d"] >= 1


def test_minor_profile_accepts_only_manual_measurements(client):
    response = client.post("/api/v1/profiles", json={"birth_year": datetime.now(UTC).year - 10})
    assert response.status_code == 201
    profile = response.json()["id"]
    assert post(client, profile, entry()).status_code == 201
    assert (
        post(
            client, profile, {**entry(80), "method": "device", "instrument": "Instrumento ficticio"}
        ).status_code
        == 422
    )
