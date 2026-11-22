"""Cross-role synthetic privacy intake. Real rights remain unimplemented."""

from uuid import uuid4

from sqlalchemy import text
from test_authenticated_api import authenticate, headers
from test_authenticated_api import protected as protected


def login(client, person):
    result = authenticate(client, person[0], person[1])
    assert result.status_code == 200, result.text
    return headers(result.json()["token"])


def test_synthetic_privacy_intake_and_administrative_triage(protected):
    client, owner, profile_id, users = protected
    editor, member, outsider, administrator = (login(client, user) for user in users)
    base = f"/api/v1/profiles/{profile_id}/privacy-requests"
    assert client.get(base).status_code == 401
    assert client.get(base, headers=outsider).status_code == 404
    assert client.post(base, headers=member, json={
        "request_type": "access", "synthetic_confirmed": False
    }).status_code == 422
    assert client.post(base, headers=member, json={
        "request_type": "access", "synthetic_confirmed": True, "private_note": "no"
    }).status_code == 422

    created = client.post(base, headers=member, json={
        "request_type": "access", "synthetic_confirmed": True
    })
    assert created.status_code == 201, created.text
    record = created.json()
    assert record["status"] == "received" and record["profile_id"] == str(profile_id)
    assert "reviewed_by" in record and record["reviewed_by"] is None
    assert "personal" not in record and "payload" not in record
    assert client.get(base, headers=editor).json()["total"] == 1
    assert client.get(base, headers=outsider).status_code == 404
    assert client.post(base, headers=member, json={
        "request_type": "access", "synthetic_confirmed": True
    }).status_code == 409
    assert client.get(base + "?limit=0", headers=member).status_code == 422
    assert client.get("/api/v1/privacy-requests", headers=editor).status_code == 403
    assert client.get("/api/v1/privacy-requests", headers=administrator).json()["total"] == 0

    with owner.begin() as conn:
        conn.execute(text("""INSERT INTO profile_access
          (id,organization_id,profile_id,user_id,access_level)
          VALUES (:id,:org,:profile,:user,'manage')"""), {
            "id": uuid4(), "org": users[3][1], "profile": profile_id, "user": users[3][0]
        })
    assert client.get("/api/v1/privacy-requests", headers=administrator).json()["total"] == 1
    path = f"/api/v1/privacy-requests/{record['id']}/review"
    assert client.post(path, headers=editor).status_code == 403
    assert client.post(path, headers=member).status_code == 403
    assert client.post(path, headers=outsider).status_code == 403
    reviewed = client.post(path, headers=administrator)
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["status"] == "in_review"
    assert reviewed.json()["reviewed_by"] == str(users[3][0])
    assert client.post(path, headers=administrator).status_code == 409
    assert client.get(base, headers=member).json()["items"][0]["status"] == "in_review"

    with owner.connect() as conn:
        actions = conn.execute(text("""SELECT action FROM security_audit_events
          WHERE resource_id=:profile AND action LIKE 'privacy.%'"""),
          {"profile": profile_id}).scalars().all()
        assert actions.count("privacy.request.created") == 1
        assert actions.count("privacy.request.review_started") == 1
        assert "privacy.request.listed" in actions


def test_privacy_request_cross_tenant_and_data_role_boundary(protected):
    client, owner, profile_id, users = protected
    outsider = login(client, users[2])
    root = f"/api/v1/profiles/{profile_id}/privacy-requests"
    assert client.post(root, headers=outsider, json={
        "request_type": "opposition", "synthetic_confirmed": True
    }).status_code == 404
    with owner.connect() as conn:
        assert not conn.execute(text("""SELECT has_table_privilege(
          'bodyvision_auth_app','public.synthetic_privacy_requests','SELECT')""")).scalar_one()
        assert not conn.execute(text("""SELECT has_table_privilege(
          'bodyvision_app','public.synthetic_privacy_requests','UPDATE')""")).scalar_one()
        assert not conn.execute(text("""SELECT has_table_privilege(
          'bodyvision_app','public.synthetic_privacy_requests','DELETE')""")).scalar_one()
        assert conn.execute(text("""SELECT has_function_privilege(
          'bodyvision_app','public.start_synthetic_privacy_review(uuid,uuid,uuid)',
          'EXECUTE')""")).scalar_one()
        assert not conn.execute(text("""SELECT has_function_privilege(
          'bodyvision_auth_app','public.start_synthetic_privacy_review(uuid,uuid,uuid)',
          'EXECUTE')""")).scalar_one()
