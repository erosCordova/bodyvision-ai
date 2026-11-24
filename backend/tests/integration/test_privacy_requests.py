"""Cross-role synthetic privacy intake. Real rights remain unimplemented."""

from datetime import datetime, timedelta
from uuid import UUID, uuid4

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
    # The specialist can open this expediente but not another person's
    # request metadata: only its submitter sees it in profile history.
    assert client.get(base, headers=editor).json()["total"] == 0
    assert client.get(base, headers=member).json()["total"] == 1
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


def test_privacy_queue_filters_overdue_and_revoked_grants(protected):
    client, owner, profile_id, users = protected
    member = login(client, users[1])
    administrator = login(client, users[3])
    base = f"/api/v1/profiles/{profile_id}/privacy-requests"
    access = client.post(
        base, headers=member, json={"request_type": "access", "synthetic_confirmed": True}
    )
    assert access.status_code == 201, access.text
    reference = access.json()["id"]
    assert access.json()["review_overdue"] is False
    with owner.begin() as conn:
        conn.execute(
            text("""INSERT INTO profile_access
              (id,organization_id,profile_id,user_id,access_level)
              VALUES (:id,:org,:profile,:user,'manage')"""),
            {"id": uuid4(), "org": users[3][1], "profile": profile_id, "user": users[3][0]},
        )
        conn.execute(
            text("""UPDATE synthetic_privacy_requests
              SET received_at=clock_timestamp()-interval '15 days',
                  review_target_at=clock_timestamp()-interval '8 days'
              WHERE id=:id"""),
            {"id": reference},
        )
    queue = "/api/v1/privacy-requests"
    assert client.get(queue + "?status=invalid", headers=administrator).status_code == 422
    assert client.get(queue + "?overdue_only=invalid", headers=administrator).status_code == 422
    assert client.get(queue + "?status=received", headers=member).status_code == 403
    due = client.get(queue + "?overdue_only=true&status=received", headers=administrator)
    assert due.status_code == 200, due.text
    assert due.json()["total"] == 1 and due.json()["items"][0]["id"] == reference
    assert due.json()["items"][0]["review_overdue"] is True
    assert client.get(queue + "?status=in_review", headers=administrator).json()["total"] == 0

    updated = client.post(f"/api/v1/privacy-requests/{reference}/review", headers=administrator)
    assert updated.status_code == 200, updated.text
    assert updated.json()["review_overdue"] is True
    assert updated.json()["review_target_at"] == due.json()["items"][0]["review_target_at"]
    assert client.get(queue + "?overdue_only=true", headers=administrator).json()["total"] == 1
    assert (
        client.get(queue + "?overdue_only=true&status=received", headers=administrator).json()[
            "total"
        ]
        == 0
    )
    in_review = client.get(queue + "?status=in_review", headers=administrator)
    assert in_review.status_code == 200
    assert in_review.json()["total"] == 1
    assert in_review.json()["items"][0]["review_overdue"] is True
    assert client.get(base, headers=member).json()["items"][0]["review_overdue"] is True
    second_page = client.get(
        queue + "?overdue_only=true&status=in_review&limit=1&offset=1", headers=administrator
    )
    assert second_page.json()["items"] == [] and second_page.json()["total"] == 1
    with owner.begin() as conn:
        conn.execute(
            text("DELETE FROM profile_access WHERE profile_id=:profile AND user_id=:actor"),
            {"profile": profile_id, "actor": users[3][0]},
        )
    assert client.get(queue + "?status=in_review", headers=administrator).json()["total"] == 0
    assert (
        client.get(f"/api/v1/profiles/{profile_id}/privacy-requests", headers=member).json()[
            "total"
        ]
        == 1
    )


def test_privacy_target_configuration_is_snapshotted_not_retroactive(protected, monkeypatch):
    client, owner, profile_id, users = protected
    member = login(client, users[1])
    base = f"/api/v1/profiles/{profile_id}/privacy-requests"
    valid = {"request_type": "access", "synthetic_confirmed": True}
    # The caller cannot choose/reset the server-controlled deadline.
    assert client.post(base, headers=member, json={**valid, "target_days": 30}).status_code == 422
    settings = client.app.state.settings
    assert settings.privacy_review_target_days == 7
    original = client.post(base, headers=member, json=valid)
    assert original.status_code == 201, original.text
    first = original.json()
    assert datetime.fromisoformat(first["review_target_at"]) - datetime.fromisoformat(
        first["received_at"]
    ) == timedelta(days=7)

    monkeypatch.setattr(settings, "privacy_review_target_days", 2)
    next_request = client.post(base, headers=member, json={**valid, "request_type": "export"})
    assert next_request.status_code == 201, next_request.text
    second = next_request.json()
    assert datetime.fromisoformat(second["review_target_at"]) - datetime.fromisoformat(
        second["received_at"]
    ) == timedelta(days=2)
    assert first["review_overdue"] is second["review_overdue"] is False

    monkeypatch.setattr(settings, "privacy_review_target_days", 30)
    persisted = client.get(base, headers=member).json()
    deadlines = {item["id"]: item["review_target_at"] for item in persisted["items"]}
    assert deadlines[first["id"]] == first["review_target_at"]
    assert deadlines[second["id"]] == second["review_target_at"]
    with owner.connect() as conn:
        stored = conn.execute(
            text(
                "SELECT review_target_at-received_at FROM synthetic_privacy_requests WHERE id=:id"
            ),
            {"id": second["id"]},
        ).scalar_one()
    assert stored == timedelta(days=2)


def test_request_history_isolation_between_same_profile_grantees_and_admin_queue(protected):
    client, owner, profile_id, users = protected
    editor, member, _, administrator = (login(client, person) for person in users)
    root = f"/api/v1/profiles/{profile_id}/privacy-requests"
    own_request = client.post(
        root, headers=member, json={"request_type": "access", "synthetic_confirmed": True}
    )
    other_request = client.post(
        root, headers=editor, json={"request_type": "export", "synthetic_confirmed": True}
    )
    assert own_request.status_code == other_request.status_code == 201
    own_id = own_request.json()["id"]
    other_id = other_request.json()["id"]

    def history(authorization, page=0):
        return client.get(root + f"?limit=1&offset={page}", headers=authorization)

    member_page = history(member)
    editor_page = history(editor)
    assert member_page.status_code == editor_page.status_code == 200
    assert member_page.json()["total"] == editor_page.json()["total"] == 1
    assert [row["id"] for row in member_page.json()["items"]] == [own_id]
    assert [row["id"] for row in editor_page.json()["items"]] == [other_id]
    assert history(member, 1).json()["items"] == []
    assert history(member, 1).json()["total"] == 1

    # The SQL RLS policy itself must restrict reads independently of the
    # HTTP WHERE predicate. The local disposable PostgreSQL owner can set
    # the exact runtime role for this one transaction (never production).
    with owner.begin() as conn:
        conn.execute(text("SET LOCAL ROLE bodyvision_app"))
        conn.execute(
            text("SELECT set_config('app.organization_id',:org,true)"),
            {"org": str(users[1][1])},
        )
        conn.execute(
            text("SELECT set_config('app.actor_id',:actor,true)"),
            {"actor": str(users[1][0])},
        )
        conn.execute(text("SELECT set_config('app.identity_verified','yes',true)"))
        visible_ids = (
            conn.execute(
                text(
                    "SELECT id FROM synthetic_privacy_requests "
                    "WHERE organization_id=:org ORDER BY id"
                ),
                {"org": users[1][1]},
            )
            .scalars()
            .all()
        )
    assert visible_ids == [UUID(own_id)]

    # Queue remains separate: administrator still needs a profile grant
    # and must not inherit another person's request history.
    assert client.get("/api/v1/privacy-requests", headers=administrator).json()["total"] == 0
    assert history(administrator).status_code == 404
    with owner.begin() as conn:
        conn.execute(
            text("""INSERT INTO profile_access
              (id,organization_id,profile_id,user_id,access_level)
              VALUES (:id,:org,:profile,:user,'manage')"""),
            {"id": uuid4(), "org": users[3][1], "profile": profile_id, "user": users[3][0]},
        )
    queue = client.get("/api/v1/privacy-requests?limit=1", headers=administrator)
    assert queue.status_code == 200
    assert queue.json()["total"] == 2 and len(queue.json()["items"]) == 1
    assert history(administrator).json()["total"] == 0

    review = client.post(f"/api/v1/privacy-requests/{own_id}/review", headers=administrator)
    assert review.status_code == 200, review.text
    assert review.json()["status"] == "in_review"
    assert history(member).json()["items"][0]["status"] == "in_review"
    assert history(editor).json()["items"][0]["id"] == other_id

    with owner.connect() as conn:
        privileges = conn.execute(
            text(
                "SELECT has_function_privilege('bodyvision_auth_app',"
                "'public.can_view_synthetic_privacy_request(uuid)','EXECUTE')"
            )
        ).scalar_one()
        assert privileges is False


def test_synthetic_rejection_is_authorized_terminal_and_audited(protected):
    client, owner, profile_id, users = protected
    editor, member, outsider, administrator = (login(client, person) for person in users)
    base = f"/api/v1/profiles/{profile_id}/privacy-requests"
    data = {"request_type": "access", "synthetic_confirmed": True}
    created = client.post(base, headers=member, json=data)
    assert created.status_code == 201, created.text
    identifier = created.json()["id"]
    root = f"/api/v1/privacy-requests/{identifier}"
    payload = {"reason": "invalid_synthetic_request", "synthetic_confirmed": True}
    assert client.post(root + "/reject", headers=administrator, json=payload).status_code == 404
    for actor in (editor, member, outsider):
        assert client.post(root + "/reject", headers=actor, json=payload).status_code == 403
    with owner.begin() as conn:
        conn.execute(
            text("""INSERT INTO profile_access
              (id,organization_id,profile_id,user_id,access_level)
              VALUES (:id,:org,:profile,:user,'manage')"""),
            {"id": uuid4(), "org": users[3][1], "profile": profile_id, "user": users[3][0]},
        )
    assert client.post(root + "/reject", headers=administrator, json=payload).status_code == 409
    assert client.post(root + "/review", headers=administrator).status_code == 200
    invalid = client.post(
        root + "/reject", headers=administrator, json={**payload, "reason": "personal note"}
    )
    assert invalid.status_code == 422
    result = client.post(root + "/reject", headers=administrator, json=payload)
    assert result.status_code == 200, result.text
    row = result.json()
    assert row["status"] == "rejected" and row["rejection_reason"] == payload["reason"]
    assert row["rejected_by"] == str(users[3][0]) and row["rejected_at"]
    assert row["review_overdue"] is False
    assert client.post(root + "/reject", headers=administrator, json=payload).status_code == 409
    assert client.get(base, headers=member).json()["items"][0]["status"] == "rejected"
    assert client.get(base, headers=editor).json()["total"] == 0
    queue = client.get("/api/v1/privacy-requests?status=rejected", headers=administrator)
    assert queue.json()["total"] == 1
    assert client.post(base, headers=member, json=data).status_code == 201
    with owner.connect() as conn:
        assert conn.execute(
            text("""SELECT count(*) FROM security_audit_events
              WHERE resource_id=:profile AND action='privacy.request.rejected'"""),
            {"profile": profile_id},
        ).scalar_one() == 1
        assert not conn.execute(
            text("""SELECT has_function_privilege('bodyvision_auth_app',
              'public.reject_synthetic_privacy_request(uuid,text,uuid,uuid)','EXECUTE')""")
        ).scalar_one()
