"""Cross-role synthetic privacy intake. Real rights remain unimplemented."""

from uuid import uuid4

from sqlalchemy import text
from test_authenticated_api import authenticate, headers
from test_authenticated_api import protected as protected


def login(client, person):
    result = authenticate(client, person[0], person[1])
    assert result.status_code == 200, result.text
    return headers(result.json()["token"])


def request_status(client, url, authorization, body):
    return client.post(url, headers=authorization, json=body).status_code


def test_synthetic_privacy_intake_and_administrative_triage(protected):
    client, owner, profile_id, users = protected
    editor, member, outsider, administrator = (login(client, person) for person in users)
    base = f"/api/v1/profiles/{profile_id}/privacy-requests"
    assert client.get(base).status_code == 401
    assert client.get(base, headers=outsider).status_code == 404

    valid = {"request_type": "access", "synthetic_confirmed": True}
    assert request_status(client, base, member, {**valid, "synthetic_confirmed": False}) == 422
    assert request_status(client, base, member, {**valid, "private_note": "no"}) == 422

    created = client.post(base, headers=member, json=valid)
    assert created.status_code == 201, created.text
    record = created.json()
    assert record["status"] == "received" and record["profile_id"] == str(profile_id)
    assert record["reviewed_by"] is None
    assert "personal" not in record and "payload" not in record
    assert client.get(base, headers=editor).json()["total"] == 1
    assert client.get(base, headers=outsider).status_code == 404
    assert request_status(client, base, member, valid) == 409
    assert client.get(base + "?limit=0", headers=member).status_code == 422
    queue = "/api/v1/privacy-requests"
    assert client.get(queue, headers=editor).status_code == 403
    assert client.get(queue, headers=administrator).json()["total"] == 0
    # Even an administrator cannot examine or triage the request without
    # an independent, explicit grant on this precise expediente.
    path = f"/api/v1/privacy-requests/{record['id']}/review"
    assert client.post(path, headers=administrator).status_code == 404

    with owner.begin() as conn:
        conn.execute(
            text("""INSERT INTO profile_access
              (id,organization_id,profile_id,user_id,access_level)
              VALUES (:id,:org,:profile,:user,'manage')"""),
            {"id": uuid4(), "org": users[3][1], "profile": profile_id, "user": users[3][0]},
        )
    assert client.get(queue, headers=administrator).json()["total"] == 1
    for unauthorized in (editor, member, outsider):
        assert client.post(path, headers=unauthorized).status_code == 403
    reviewed = client.post(path, headers=administrator)
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["status"] == "in_review"
    assert reviewed.json()["reviewed_by"] == str(users[3][0])
    assert client.post(path, headers=administrator).status_code == 409
    assert client.get(base, headers=member).json()["items"][0]["status"] == "in_review"

    with owner.connect() as conn:
        actions = (
            conn.execute(
                text("""SELECT action FROM security_audit_events
                  WHERE resource_id=:profile AND action LIKE 'privacy.%'"""),
                {"profile": profile_id},
            )
            .scalars()
            .all()
        )
        assert actions.count("privacy.request.created") == 1
        assert actions.count("privacy.request.review_started") == 1
        assert "privacy.request.listed" in actions


def test_privacy_request_cross_tenant_and_data_role_boundary(protected):
    client, owner, profile_id, users = protected
    outsider = login(client, users[2])
    root = f"/api/v1/profiles/{profile_id}/privacy-requests"
    assert (
        request_status(
            client, root, outsider, {"request_type": "opposition", "synthetic_confirmed": True}
        )
        == 404
    )
    with owner.connect() as conn:
        for privilege in ("UPDATE", "DELETE"):
            assert not conn.execute(
                text("""SELECT has_table_privilege(
                  'bodyvision_app','public.synthetic_privacy_requests',:permission)"""),
                {"permission": privilege},
            ).scalar_one()
        assert not conn.execute(
            text("""SELECT has_table_privilege(
              'bodyvision_auth_app','public.synthetic_privacy_requests','SELECT')""")
        ).scalar_one()
        signature = "public.start_synthetic_privacy_review(uuid,uuid,uuid)"
        for role, expected in (("bodyvision_app", True), ("bodyvision_auth_app", False)):
            assert (
                conn.execute(
                    text("SELECT has_function_privilege(:role,:signature,'EXECUTE')"),
                    {"role": role, "signature": signature},
                ).scalar_one()
                is expected
            )
