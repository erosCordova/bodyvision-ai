from pathlib import Path
from uuid import uuid4

from sqlalchemy import text
from test_authenticated_api import _synthetic_png, authenticate, headers
from test_authenticated_api import protected as protected
from test_pose_summary_api import accept

from app.services.capture_crypto import CaptureCipher
from app.services.server_pose_inference import PoseResult
from app.workers import server_pose


def test_queue_worker_review_and_revocation(protected, monkeypatch):
    client, owner, profile, users = protected
    writer, reader, foreign = [
        headers(authenticate(client, person[0], person[1]).json()["token"])
        for person in users[:3]
    ]
    capture_root = f"/api/v1/profiles/{profile}/captures"
    consent_ids = {
        purpose: accept(client, writer, profile, purpose) for purpose in ("capture", "storage")
    }
    image = _synthetic_png()
    saved = client.post(
        capture_root,
        content=image,
        headers={**writer, "Content-Type": "image/png", "X-Synthetic-Only": "confirmed"},
    )
    assert saved.status_code == 201, saved.text
    path = f"{capture_root}/{saved.json()['id']}/server-pose"
    body = {"synthetic_confirmed": True}
    assert client.post(path, headers=writer, json=body).status_code == 503
    monkeypatch.setattr(client.app.state.settings, "server_pose_queue_enabled", True)
    assert client.post(path, headers=writer, json=body).status_code == 403
    consent_ids["pose"] = accept(client, writer, profile, "pose")
    assert client.post(path, headers=reader, json=body).status_code == 403
    assert client.get(path, headers=foreign).status_code == 404
    queued = client.post(path, headers=writer, json=body)
    assert queued.status_code == 202, queued.text
    job = queued.json()
    assert job["status"] == "queued" and job["attempts"] == 0
    assert client.post(path, headers=writer, json=body).json()["id"] == job["id"]
    with owner.connect() as connection:
        for role in ("bodyvision_app", "bodyvision_auth_app"):
            assert not connection.execute(
                text(
                    "SELECT has_function_privilege(:role,'public.claim_server_pose(uuid)','EXECUTE')"
                ),
                {"role": role},
            ).scalar_one()
    # Controlled adapter in this SQL integration test only; it is not proof
    # of real MediaPipe inference. The worker still decrypts and verifies the PNG.
    def controlled_inference(payload, model):
        assert payload == image
        return PoseResult(detected=True, visible_points=24)

    monkeypatch.setattr(server_pose, "run_inference", controlled_inference)
    cipher = CaptureCipher.from_settings(client.app.state.settings)
    assert server_pose.run_once(owner, cipher, Path("test-adapter-only"))
    result = client.get(path, headers=reader).json()
    assert result["status"] == "needs_review" and result["attempts"] == 1
    assert result["result"]["visible_points"] == 24 and result["origin"] == "server_model"
    review = {**body, "decision": "accepted"}
    assert client.post(path + "/review", headers=reader, json=review).status_code == 403
    accepted = client.post(path + "/review", headers=writer, json=review)
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "accepted"
    assert client.post(path + "/review", headers=writer, json=review).status_code == 409
    with owner.begin() as connection:
        connection.execute(text("SET LOCAL ROLE bodyvision_pose_worker"))
        assert not connection.execute(
            text("SELECT finish_server_pose(:id,:token,NULL,'TIMEOUT')"),
            {"id": job["id"], "token": uuid4()},
        ).scalar_one()
    revoked = client.post(
        f"/api/v1/auth/profiles/{profile}/consents/{consent_ids['pose']}/revoke",
        headers=writer,
    )
    assert revoked.status_code == 200, revoked.text
    assert client.get(path, headers=writer).status_code == 403
    with owner.connect() as connection:
        count = connection.execute(
            text("SELECT count(*) FROM server_pose_jobs WHERE profile_id=:profile"),
            {"profile": profile},
        ).scalar_one()
        assert count == 0
