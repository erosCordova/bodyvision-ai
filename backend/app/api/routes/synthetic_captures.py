"""Private encrypted storage of small synthetic PNGs, never clinical originals."""

import hashlib
from datetime import datetime
from typing import Annotated
from uuid import UUID, uuid4

from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import workspace
from app.core.errors import DomainError
from app.models.context import Workspace
from app.repositories import records
from app.services.synthetic_capture_png import MAX_CAPTURE_BYTES, validate_synthetic_png

router = APIRouter(prefix="/api/v1", tags=["Private fictional capture archive"])
Scope = Annotated[Workspace, Depends(workspace, scope="function")]
FIELDS = """id,profile_id,created_by,format,original_bytes,width,height,
 sha256_digest,created_at,expires_at"""


class SyntheticCaptureRead(BaseModel):
    id: UUID
    profile_id: UUID
    created_by: UUID
    format: str
    original_bytes: int
    width: int
    height: int
    sha256_digest: str
    created_at: datetime
    expires_at: datetime
    data_type: str = "SIMULADO"


class SyntheticCaptureList(BaseModel):
    items: list[SyntheticCaptureRead]
    total: int


def _cipher(request: Request) -> Fernet:
    settings = request.app.state.settings
    if (
        not settings.identity_enabled
        or settings.app_env not in {"test", "local"}
        or settings.capture_encryption_key is None
    ):
        raise DomainError(503, "CAPTURE_STORAGE_DISABLED", "Archivo privado no habilitado.")
    return Fernet(settings.capture_encryption_key.get_secret_value().encode("ascii"))


def _consented(scope: Workspace, profile_id: UUID) -> None:
    allowed = scope.connection.execute(
        text("SELECT lock_current_synthetic_capture_consent(:profile)"),
        {"profile": profile_id},
    ).scalar_one()
    if not allowed:
        raise DomainError(
            403,
            "CAPTURE_CONSENT_REQUIRED",
            "Se requieren aceptaciones ficticias vigentes para captura y conservación.",
        )


def _audit(scope: Workspace, action: str, profile_id: UUID) -> None:
    if scope.correlation_id is None:
        raise DomainError(403, "FORBIDDEN", "Contexto privado requerido.")
    scope.connection.execute(
        text("SELECT audit_synthetic_capture(:event,:correlation,:profile,:action)"),
        {
            "event": uuid4(),
            "correlation": scope.correlation_id,
            "profile": profile_id,
            "action": action,
        },
    ).scalar_one()


def _row(scope: Workspace, profile_id: UUID, capture_id: UUID) -> dict:
    selected = scope.connection.execute(
        text(f"""SELECT {FIELDS},ciphertext FROM synthetic_capture_objects
          WHERE organization_id=:org AND profile_id=:profile AND id=:id
            AND expires_at>now()"""),
        {"org": scope.organization_id, "profile": profile_id, "id": capture_id},
    ).mappings().one_or_none()
    if selected is None:
        raise DomainError(404, "NOT_FOUND", "Captura ficticia no disponible.")
    return dict(selected)


@router.post(
    "/profiles/{profile_id}/captures",
    response_model=SyntheticCaptureRead,
    status_code=201,
)
async def upload_synthetic_capture(
    profile_id: UUID, scope: Scope, request: Request
):
    cipher = _cipher(request)
    if not scope.authenticated or scope.role not in {"administrator", "specialist"}:
        raise DomainError(403, "FORBIDDEN", "Solo usuarios de prueba con permisos de edición.")
    records.profile(scope, profile_id, write=True)
    _consented(scope, profile_id)
    if request.headers.get("X-Synthetic-Only") != "confirmed":
        raise DomainError(422, "SYNTHETIC_CONFIRMATION_REQUIRED", "Confirma datos ficticios.")
    if request.headers.get("Content-Type", "").lower() != "image/png":
        raise DomainError(415, "UNSUPPORTED_MEDIA_TYPE", "Solo PNG sintéticos.")
    claimed_size = request.headers.get("Content-Length")
    if claimed_size and (not claimed_size.isdigit() or int(claimed_size) > MAX_CAPTURE_BYTES):
        raise DomainError(413, "CAPTURE_SIZE", "El PNG supera 256 KiB.")
    # Stream with an absolute bound, including clients without Content-Length.
    payload = bytearray()
    async for part in request.stream():
        payload.extend(part)
        if len(payload) > MAX_CAPTURE_BYTES:
            raise DomainError(413, "CAPTURE_SIZE", "El PNG supera 256 KiB.")
    contents = bytes(payload)
    width, height = validate_synthetic_png(contents)
    identifier = uuid4()
    params = {
        "id": identifier, "org": scope.organization_id, "profile": profile_id,
        "actor": scope.actor_id, "size": len(contents), "width": width,
        "height": height, "sha": hashlib.sha256(contents).hexdigest(),
        "encrypted": cipher.encrypt(contents),
    }
    row = scope.connection.execute(
        text(f"""INSERT INTO synthetic_capture_objects(
          id,organization_id,profile_id,created_by,original_bytes,
          width,height,sha256_digest,ciphertext
        ) VALUES (
          :id,:org,:profile,:actor,:size,:width,:height,:sha,:encrypted
        ) RETURNING {FIELDS}"""),
        params,
    ).mappings().one()
    _audit(scope, "capture.create", profile_id)
    return {**row, "data_type": "SIMULADO"}


@router.get(
    "/profiles/{profile_id}/captures", response_model=SyntheticCaptureList
)
def list_synthetic_captures(profile_id: UUID, scope: Scope, request: Request):
    _cipher(request)
    records.profile(scope, profile_id)
    _consented(scope, profile_id)
    rows = scope.connection.execute(
        text(f"""SELECT {FIELDS} FROM synthetic_capture_objects
          WHERE organization_id=:org AND profile_id=:profile AND expires_at>now()
          ORDER BY created_at DESC,id DESC LIMIT 50"""),
        {"org": scope.organization_id, "profile": profile_id},
    ).mappings().all()
    _audit(scope, "capture.list", profile_id)
    return {"items": [{**row, "data_type": "SIMULADO"} for row in rows], "total": len(rows)}


@router.get("/profiles/{profile_id}/captures/{capture_id}")
def download_synthetic_capture(
    profile_id: UUID, capture_id: UUID, scope: Scope, request: Request
):
    cipher = _cipher(request)
    records.profile(scope, profile_id)
    _consented(scope, profile_id)
    row = _row(scope, profile_id, capture_id)
    try:
        pixels = cipher.decrypt(bytes(row["ciphertext"]))
    except InvalidToken as exc:
        raise DomainError(500, "CAPTURE_UNAVAILABLE", "Archivo cifrado no disponible.") from exc
    if hashlib.sha256(pixels).hexdigest() != row["sha256_digest"]:
        raise DomainError(500, "CAPTURE_UNAVAILABLE", "Archivo cifrado no disponible.")
    _audit(scope, "capture.read", profile_id)
    return Response(
        content=pixels,
        media_type="application/octet-stream",
        headers={"Content-Disposition": 'attachment; filename="captura-ficticia.png"'},
    )


@router.delete("/profiles/{profile_id}/captures/{capture_id}", status_code=204)
def delete_synthetic_capture(
    profile_id: UUID, capture_id: UUID, scope: Scope, request: Request
):
    _cipher(request)
    if scope.role not in {"administrator", "specialist"}:
        raise DomainError(403, "FORBIDDEN", "El permiso de lectura no permite borrar.")
    records.profile(scope, profile_id, write=True)
    deleted = scope.connection.execute(
        text("""DELETE FROM synthetic_capture_objects
          WHERE organization_id=:org AND profile_id=:profile AND id=:id
          RETURNING id"""),
        {"org": scope.organization_id, "profile": profile_id, "id": capture_id},
    ).scalar_one_or_none()
    if deleted is None:
        raise DomainError(404, "NOT_FOUND", "Captura ficticia no disponible.")
    _audit(scope, "capture.delete", profile_id)
    return Response(status_code=204)


@router.post("/profiles/{profile_id}/captures/purge-expired")
def purge_expired_synthetic_captures(
    profile_id: UUID, scope: Scope, request: Request
):
    _cipher(request)
    if scope.role not in {"administrator", "specialist"}:
        raise DomainError(403, "FORBIDDEN", "Se requiere permiso de edición.")
    records.profile(scope, profile_id, write=True)
    deleted = scope.connection.execute(
        text("""DELETE FROM synthetic_capture_objects
          WHERE organization_id=:org AND profile_id=:profile AND expires_at<=now()
          RETURNING id"""),
        {"org": scope.organization_id, "profile": profile_id},
    ).scalars().all()
    _audit(scope, "capture.purge", profile_id)
    return {"deleted": len(deleted)}
