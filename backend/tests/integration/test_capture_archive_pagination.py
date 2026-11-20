"""Paged fictional archive must preserve consent, total, and tenant isolation."""

import hashlib
from uuid import uuid4

from cryptography.fernet import Fernet
from sqlalchemy import text
from test_authenticated_api import _synthetic_png, authenticate, headers
from test_authenticated_api import protected as protected

from app.models.context import FIRST_WORKSPACE


def test_capture_archive_pages_complete_authorized_inventory(protected):
    client, owner, profile_id, users = protected
    editor, member, outsider = users[:3]
    writer = headers(authenticate(client, editor[0], editor[1]).json()["token"])
    reader = headers(authenticate(client, member[0], member[1]).json()["token"])
    foreign = headers(authenticate(client, outsider[0], outsider[1]).json()["token"])
    root = f"/api/v1/profiles/{profile_id}/captures"
    for purpose in ("capture", "storage"):
        accepted = client.post(
            f"/api/v1/auth/profiles/{profile_id}/consents",
            headers=writer,
            json={"purpose": purpose, "version": "bv-synthetic-v1", "confirmed": True},
        )
        assert accepted.status_code == 200

    png = _synthetic_png()
    key = client.app.state.settings.capture_encryption_key.get_secret_value()
    cipher = Fernet(key.encode("ascii")).encrypt(png)
    digest = hashlib.sha256(png).hexdigest()
    ids = [uuid4() for _ in range(57)]
    with owner.begin() as connection:
        connection.execute(
            text("""
                INSERT INTO synthetic_capture_objects (
                    id,organization_id,profile_id,created_by,original_bytes,
                    width,height,sha256_digest,ciphertext,created_at,expires_at
                ) VALUES (
                    :id,:org,:profile,:user,:size,32,64,:digest,:cipher,
                    now()-interval '1 hour',now()+interval '6 days'
                )
            """),
            [
                {
                    "id": identifier,
                    "org": FIRST_WORKSPACE,
                    "profile": profile_id,
                    "user": editor[0],
                    "size": len(png),
                    "digest": digest,
                    "cipher": cipher,
                }
                for identifier in ids
            ],
        )
        connection.execute(
            text("""
                UPDATE synthetic_capture_objects
                SET created_at=now()-interval '8 days',
                    expires_at=now()-interval '1 day'
                WHERE id=:id
            """),
            {"id": ids[-1]},
        )

    all_seen = []
    for offset, expected in ((0, 20), (20, 20), (40, 16), (60, 0)):
        result = client.get(root, params={"limit": 20, "offset": offset}, headers=reader)
        assert result.status_code == 200, result.text
        body = result.json()
        assert body["total"] == 56
        assert len(body["items"]) == expected
        assert all(row["data_type"] == "SIMULADO" for row in body["items"])
        assert result.headers["cache-control"] == "no-store, private"
        assert result.headers["pragma"] == "no-cache"
        assert result.headers["x-content-type-options"] == "nosniff"
        assert "set-cookie" not in result.headers
        all_seen.extend(row["id"] for row in body["items"])
    assert len(all_seen) == len(set(all_seen)) == 56
    assert str(ids[-1]) not in all_seen
    middle = client.get(root, params={"limit": 2, "offset": 19}, headers=writer)
    assert [row["id"] for row in middle.json()["items"]] == all_seen[19:21]
    assert client.get(root, headers=writer).json()["total"] == 56
    assert client.get(root, headers=foreign).status_code == 404
    for params in ({"limit": 0}, {"limit": 51}, {"offset": -1}, {"offset": 10001}):
        assert client.get(root, params=params, headers=writer).status_code == 422

    consents = client.get(
        f"/api/v1/auth/profiles/{profile_id}/consents", headers=writer
    ).json()["items"]
    storage_id = next(row["id"] for row in consents if row["purpose"] == "storage")
    revoked = client.post(
        f"/api/v1/auth/profiles/{profile_id}/consents/{storage_id}/revoke",
        headers=writer,
    )
    assert revoked.status_code == 200
    assert client.get(root, headers=reader).status_code == 403
    with owner.connect() as connection:
        remaining = connection.execute(
            text("SELECT count(*) FROM synthetic_capture_objects WHERE profile_id=:id"),
            {"id": profile_id},
        ).scalar_one()
        assert remaining == 0
