import hashlib
import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import text
from test_authenticated_api import authenticate, headers
from test_authenticated_api import protected as protected
from test_mfa_step_up import _credentials, _enable_mfa
from test_privacy_officer import enroll, make_officer

from app.core.audit_bundle import MAX_AUDIT_BYTES, verify_audit_bundle


def append_events(owner, user, count, action="test.audit_export", resource="audit"):
    with owner.begin() as conn:
        conn.execute(
            text("""INSERT INTO security_audit_events
          (id,organization_id,actor_id,correlation_id,action,resource_type,outcome)
          SELECT gen_random_uuid(),:org,:actor,gen_random_uuid(),:action,:resource,'allowed'
          FROM generate_series(1,:count)"""),
            {
                "org": user[1],
                "actor": user[0],
                "count": count,
                "action": action,
                "resource": resource,
            },
        )


def generation_count(owner, org):
    with owner.connect() as conn:
        return conn.execute(
            text(
                """SELECT count(*) FROM security_audit_events WHERE organization_id=:org
                  AND action='audit.export_generated'"""
            ),
            {"org": org},
        ).scalar_one()


def test_full_audit_export_is_scoped_verifiable_and_has_a_generation_event(protected):
    client, owner, _, users = protected
    admin = headers(authenticate(client, *users[3][:2]).json()["token"])
    member = headers(authenticate(client, *users[1][:2]).json()["token"])
    assert client.post("/api/v1/auth/audit/export", json={}).status_code == 401
    assert client.post("/api/v1/auth/audit/export", headers=member, json={}).status_code == 403
    assert (
        client.post(
            "/api/v1/auth/audit/export",
            headers={**admin, "X-Workspace-ID": str(users[2][1])},
            json={},
        ).status_code
        == 400
    )
    append_events(owner, users[3], 45, action="test.acción_ñ")
    authenticate(client, *users[2][:2])
    exported = client.post("/api/v1/auth/audit/export", headers=admin, json={})
    assert exported.status_code == 200, exported.text
    assert exported.headers["cache-control"] == "no-store"
    assert exported.headers["x-content-sha256"] == hashlib.sha256(exported.content).hexdigest()
    source = exported.json()
    checkpoint = verify_audit_bundle(source)
    assert checkpoint.sequence > 30
    assert source["organization_id"] == str(users[3][1]) and source["external_anchor"] is False
    assert (
        exported.headers["content-disposition"]
        == f'attachment; filename="bodyvision-audit-{source["export_id"]}.json"'
    )
    assert len(exported.content) <= MAX_AUDIT_BYTES
    for event in source["events"]:
        payload = json.loads(event["payload"])
        assert payload[4] == str(users[3][1])
        assert payload[7] != "audit.export_generated"
    assert generation_count(owner, users[3][1]) == 1
    with owner.connect() as conn:
        generated = conn.execute(
            text("SELECT chain_sequence FROM security_audit_events WHERE id=:id"),
            {"id": source["export_id"]},
        ).scalar_one()
        assert generated == checkpoint.sequence + 1
        for role, allowed in (("bodyvision_app", False), ("bodyvision_auth_app", True)):
            assert (
                conn.execute(
                    text(
                        """SELECT has_function_privilege(:role,
                          'public.export_private_audit_chain(char(64),uuid,uuid)','EXECUTE')"""
                    ),
                    {"role": role},
                ).scalar_one()
                is allowed
            )
            assert not conn.execute(
                text("SELECT has_table_privilege(:role,'public.security_audit_events','SELECT')"),
                {"role": role},
            ).scalar_one()


@pytest.mark.parametrize("tamper", ["bytes", "tail"])
def test_tampered_audit_never_delivers_a_file_or_generation_success(protected, tamper):
    client, owner, _, users = protected
    admin = headers(authenticate(client, *users[3][:2]).json()["token"])
    append_events(owner, users[3], 3)
    with owner.begin() as conn:
        if tamper == "bytes":
            conn.execute(
                text(
                    """UPDATE security_audit_events SET action='tampered'
                      WHERE organization_id=:org AND chain_sequence=2"""
                ),
                {"org": users[3][1]},
            )
        else:
            conn.execute(
                text(
                    "DELETE FROM security_audit_events WHERE organization_id=:org "
                    "AND chain_sequence=4"
                ),
                {"org": users[3][1]},
            )
    result = client.post("/api/v1/auth/audit/export", headers=admin, json={})
    assert result.status_code == 409
    assert "content-disposition" not in result.headers and "events" not in result.json()
    assert generation_count(owner, users[3][1]) == 0
    with owner.connect() as conn:
        assert (
            conn.execute(
                text(
                    "SELECT count(*) FROM security_audit_events WHERE organization_id=:org "
                    "AND action='audit.export_failed'"
                ),
                {"org": users[3][1]},
            ).scalar_one()
            == 1
        )


def test_audit_export_does_not_truncate_at_row_limit(protected):
    client, owner, _, users = protected
    admin = headers(authenticate(client, *users[3][:2]).json()["token"])
    append_events(owner, users[3], 10000)
    response = client.post("/api/v1/auth/audit/export", headers=admin, json={})
    assert response.status_code == 413, response.text
    assert "content-disposition" not in response.headers
    assert generation_count(owner, users[3][1]) == 0


def test_audit_export_rejects_byte_budget_even_below_row_limit(protected):
    client, owner, _, users = protected
    admin = headers(authenticate(client, *users[3][:2]).json()["token"])
    append_events(owner, users[3], 8500, action="🧪" * 100, resource="🧬" * 60)
    response = client.post("/api/v1/auth/audit/export", headers=admin, json={})
    assert response.status_code == 413, response.text
    assert "content-disposition" not in response.headers
    assert generation_count(owner, users[3][1]) == 0


def test_generation_and_head_roll_back_if_audit_insert_fails(protected):
    client, owner, _, users = protected
    admin = headers(authenticate(client, *users[3][:2]).json()["token"])
    with owner.connect() as conn:
        previous = conn.execute(
            text(
                "SELECT last_sequence,last_hash FROM private_audit_heads WHERE organization_id=:org"
            ),
            {"org": users[3][1]},
        ).one()
    try:
        with owner.begin() as conn:
            conn.execute(
                text("""CREATE FUNCTION test_export_audit_failure() RETURNS trigger
              LANGUAGE plpgsql AS $$
              BEGIN IF NEW.action='audit.export_generated' THEN
                RAISE EXCEPTION 'Synthetic export failure';
              END IF; RETURN NEW; END $$;
              CREATE TRIGGER test_export_audit_failure BEFORE INSERT ON security_audit_events
              FOR EACH ROW EXECUTE FUNCTION test_export_audit_failure();""")
            )
        result = client.post("/api/v1/auth/audit/export", headers=admin, json={})
        assert result.status_code == 500 and "content-disposition" not in result.headers
        with owner.connect() as conn:
            assert (
                conn.execute(
                    text(
                        "SELECT last_sequence,last_hash FROM private_audit_heads "
                        "WHERE organization_id=:org"
                    ),
                    {"org": users[3][1]},
                ).one()
                == previous
            )
        assert generation_count(owner, users[3][1]) == 0
    finally:
        with owner.begin() as conn:
            conn.execute(
                text(
                    "DROP TRIGGER IF EXISTS test_export_audit_failure ON security_audit_events; "
                    "DROP FUNCTION IF EXISTS test_export_audit_failure()"
                )
            )


def test_export_is_consistent_during_a_concurrent_append(protected):
    client, owner, _, users = protected
    admin = headers(authenticate(client, *users[3][:2]).json()["token"])
    append_events(owner, users[3], 200)
    with ThreadPoolExecutor(max_workers=2) as pool:
        exporting = pool.submit(client.post, "/api/v1/auth/audit/export", headers=admin, json={})
        appending = pool.submit(append_events, owner, users[3], 1)
        result = exporting.result()
        appending.result()
    assert result.status_code == 200, result.text
    assert verify_audit_bundle(result.json()).sequence in (201, 202)


def test_privacy_officer_cannot_export_organization_audit(protected, monkeypatch):
    client, owner, _, users = protected
    make_officer(owner, users[1])
    clock = _enable_mfa(client, monkeypatch)
    _, officer = enroll(client, _credentials(users[1]), clock)
    response = client.post("/api/v1/auth/audit/export", headers=headers(officer["token"]), json={})
    assert response.status_code == 403
    assert generation_count(owner, users[1][1]) == 0
