import base64
import hashlib
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import text
from test_authenticated_api import authenticate, headers
from test_authenticated_api import protected as protected


@pytest.fixture
def comparison_data(protected):
    client, owner, profile, users = protected
    writer = headers(authenticate(client, users[0][0], users[0][1]).json()["token"])
    reader = headers(authenticate(client, users[1][0], users[1][1]).json()["token"])
    root = f"/api/v1/profiles/{profile}"
    created = []
    try:
        for days, value in ((30, 70), (1, 77)):
            body = {
                "metric_code": "weight",
                "unit": "kg",
                "value": value,
                "method": "manual",
                "measured_at": (datetime.now(UTC) - timedelta(days=days)).isoformat(),
            }
            result = client.post(
                root + "/measurements",
                json=body,
                headers={**writer, "Idempotency-Key": str(uuid4())},
            )
            assert result.status_code == 201, result.text
            created.append(result.json())
        yield client, owner, profile, users, writer, reader, created
    finally:
        with owner.begin() as conn:
            conn.execute(
                text(
                    "DELETE FROM idempotency_keys WHERE measurement_id IN "
                    "(SELECT id FROM measurements WHERE profile_id=:profile)"
                ),
                {"profile": profile},
            )
            conn.execute(text("ALTER TABLE measurements DISABLE TRIGGER immutable_measurements"))
            conn.execute(
                text("DELETE FROM measurements WHERE profile_id=:profile"), {"profile": profile}
            )
            conn.execute(text("ALTER TABLE measurements ENABLE TRIGGER immutable_measurements"))


def test_private_pdf_checks_scope_sources_and_committed_audit(comparison_data):
    client, owner, profile, users, writer, reader, rows = comparison_data
    root = f"/api/v1/profiles/{profile}/reports/comparison"
    selection = {"initial_id": rows[0]["id"], "final_id": rows[1]["id"]}
    assert client.post(root, json=selection).status_code == 401
    outsider = headers(authenticate(client, users[2][0], users[2][1]).json()["token"])
    assert client.post(root, json=selection, headers=outsider).status_code == 404
    response = client.post(root, json=selection, headers=reader)
    assert response.status_code == 200, response.text
    body = response.json()
    pdf = base64.b64decode(body["pdf_base64"], validate=True)
    assert pdf.startswith(b"%PDF-1.4")
    assert hashlib.sha256(pdf).hexdigest() == body["sha256"]
    assert all(row["id"].encode() in pdf for row in rows)
    assert "no-store" in response.headers["cache-control"]
    with owner.connect() as conn:
        event = (
            conn.execute(
                text("SELECT * FROM security_audit_events WHERE id=:id"), {"id": body["report_id"]}
            )
            .mappings()
            .one()
        )
        assert event["action"] == "report.export"
        assert event["resource_id"] == profile
        assert event["actor_id"] == users[1][0]
        assert event["chain_sequence"] > 0
    assert (
        client.post(
            root, json={"initial_id": rows[1]["id"], "final_id": rows[0]["id"]}, headers=reader
        ).status_code
        == 409
    )
    assert (
        client.post(root, json={**selection, "final_id": rows[0]["id"]}, headers=reader).status_code
        == 422
    )
    assert client.post(root, json={**selection, "value": 999}, headers=reader).status_code == 422
    with owner.begin() as conn:
        # Owner-only fixture change imitates a source replaced by a correction.
        conn.execute(text("ALTER TABLE measurements DISABLE TRIGGER immutable_measurements"))
        conn.execute(
            text("UPDATE measurements SET is_current=false WHERE id=:id"), {"id": rows[0]["id"]}
        )
        conn.execute(text("ALTER TABLE measurements ENABLE TRIGGER immutable_measurements"))
    assert client.post(root, json=selection, headers=writer).status_code == 409
    with owner.connect() as conn:
        assert (
            conn.execute(
                text(
                    "SELECT count(*) FROM security_audit_events "
                    "WHERE resource_id=:id AND action='report.export'"
                ),
                {"id": profile},
            ).scalar_one()
            == 1
        )


def test_pdf_is_not_delivered_if_audit_cannot_be_committed(comparison_data):
    client, _, profile, _, _, reader, rows = comparison_data
    original = client.app.state.engine
    from sqlalchemy import event

    def fail_audit(conn, cursor, statement, parameters, context, executemany):
        if "audit_private_comparison_export" in statement:
            raise RuntimeError("Synthetic audit failure")

    event.listen(original, "before_cursor_execute", fail_audit)
    try:
        result = client.post(
            f"/api/v1/profiles/{profile}/reports/comparison",
            headers=reader,
            json={"initial_id": rows[0]["id"], "final_id": rows[1]["id"]},
        )
        assert result.status_code == 500
        assert "pdf_base64" not in result.text
    finally:
        event.remove(original, "before_cursor_execute", fail_audit)


def test_longitudinal_csv_scoped_audited_complete_and_hash_verified(comparison_data):
    import csv
    import io

    client, owner, profile, users, writer, reader, rows = comparison_data
    endpoint = f"/api/v1/profiles/{profile}/reports/longitudinal"
    data = {"metric_code": "weight", "period": "all"}
    assert client.post(endpoint, json=data).status_code == 401
    outsider = headers(authenticate(client, users[2][0], users[2][1]).json()["token"])
    assert client.post(endpoint, json=data, headers=outsider).status_code == 404
    response = client.post(endpoint, json=data, headers=reader)
    assert response.status_code == 200, response.text
    assert "no-store" in response.headers["cache-control"]
    body = response.json()
    csv_bytes = base64.b64decode(body["csv_base64"], validate=True)
    assert hashlib.sha256(csv_bytes).hexdigest() == body["sha256"]
    parsed = list(csv.DictReader(io.StringIO(csv_bytes.decode("utf-8"))))
    assert body["row_count"] == 2
    assert [item["source_measurement_id"] for item in parsed] == [
        rows[0]["id"],
        rows[1]["id"],
    ]
    assert [item["value"] for item in parsed] == ["70", "77"]
    assert all(item["metric_code"] == "weight" for item in parsed)
    assert b"SIMULADO" not in csv_bytes
    assert body["filename"] == f"bodyvision-historial-{body['export_id']}.csv"
    with owner.connect() as conn:
        audit = (
            conn.execute(
                text("SELECT * FROM security_audit_events WHERE id=:id"),
                {"id": body["export_id"]},
            )
            .mappings()
            .one()
        )
        assert audit["action"] == "report.export"
        assert audit["resource_id"] == profile
        assert audit["actor_id"] == users[1][0]
        assert audit["chain_sequence"] > 0
    for invalid in (
        {"metric_code": "missing", "period": "all"},
        {"metric_code": "weight", "period": "bad"},
        {**data, "extra": "forbidden"},
        {"metric_code": "height", "period": "all"},
    ):
        assert client.post(endpoint, json=invalid, headers=reader).status_code == 422
    with owner.begin() as conn:
        conn.execute(text("ALTER TABLE measurements DISABLE TRIGGER immutable_measurements"))
        conn.execute(
            text("UPDATE measurements SET is_current=false WHERE id=:id"),
            {"id": rows[0]["id"]},
        )
        conn.execute(text("ALTER TABLE measurements ENABLE TRIGGER immutable_measurements"))
    updated = client.post(endpoint, json=data, headers=reader)
    assert updated.status_code == 200, updated.text
    assert updated.json()["row_count"] == 1
    assert rows[0]["id"].encode() not in base64.b64decode(updated.json()["csv_base64"])


def test_longitudinal_csv_fails_closed_if_audit_cannot_commit(comparison_data):
    from sqlalchemy import event

    client, _, profile, _, _, reader, _ = comparison_data
    engine = client.app.state.engine

    def fail_audit(conn, cursor, statement, parameters, context, executemany):
        if "audit_private_comparison_export" in statement:
            raise RuntimeError("Synthetic report audit failure")

    event.listen(engine, "before_cursor_execute", fail_audit)
    try:
        result = client.post(
            f"/api/v1/profiles/{profile}/reports/longitudinal",
            headers=reader,
            json={"metric_code": "weight", "period": "all"},
        )
        assert result.status_code == 500
        assert "csv_base64" not in result.text
    finally:
        event.remove(engine, "before_cursor_execute", fail_audit)
