"""Encrypted fictional image library, hosted sandbox only."""
import hashlib
import os
from typing import Annotated, Literal
from uuid import UUID, uuid4

from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import text

from app.api.deps import workspace
from app.api.routes.synthetic_captures import SyntheticCaptureRead
from app.core.errors import DomainError
from app.models.context import Workspace
from pydantic import BaseModel
from app.repositories import records
from app.services.b2_capture_store import B2Store, B2Error, object_name
from starlette.concurrency import run_in_threadpool
from app.services.synthetic_capture_png import MAX_CAPTURE_BYTES, validate_synthetic_png

router = APIRouter(prefix="/api/v1", tags=["Sandbox fictional images"])
Scope = Annotated[Workspace, Depends(workspace, scope="function")]
Pose = Literal['front','side','back','unspecified']
class SandboxCaptureRead(SyntheticCaptureRead):
    posture: Pose = 'unspecified'

class SandboxCaptureList(BaseModel):
    items: list[SandboxCaptureRead]
    total: int

FIELDS = "id,profile_id,created_by,original_bytes,width,height,sha256_digest,created_at,expires_at,posture,'image/png' AS format"


def cipher(request):
    key = request.app.state.settings.sandbox_capture_key
    if request.app.state.settings.app_env != "sandbox" or key is None:
        raise DomainError(503,"CAPTURE_STORAGE_DISABLED","Archivo de pruebas no disponible.")
    return Fernet(key.get_secret_value().encode("ascii"))


def storage():
    if os.environ.get("CAPTURE_STORAGE","postgres")!="b2":
        return None
    try:
        return B2Store()
    except (B2Error,KeyError,ValueError,TypeError):
        raise DomainError(503,"CAPTURE_STORAGE_DISABLED","Almacenamiento de imágenes no disponible.") from None


def context(scope, profile_id, write=False):
    row=records.profile(scope,profile_id,write=write)
    if row["status"] != "active":
        raise DomainError(403,"FORBIDDEN","Reactiva el expediente para acceder a las imágenes.")
    return {"org":scope.organization_id,"profile":profile_id,"actor":scope.actor_id}


@router.post("/profiles/{profile_id}/captures",status_code=201,response_model=SandboxCaptureRead)
async def upload(profile_id:UUID,scope:Scope,request:Request,posture:Pose=Query('unspecified')):
    key=cipher(request)
    params=context(scope,profile_id,True)
    if request.headers.get("X-Synthetic-Only")!="confirmed":
        raise DomainError(422,"SYNTHETIC_CONFIRMATION_REQUIRED","Confirma que la imagen es ficticia.")
    if request.headers.get("Content-Type")!="image/png":
        raise DomainError(415,"INVALID_PNG","Solo PNG sin metadatos.")
    payload=bytearray()
    async for part in request.stream():
        if len(payload)+len(part)>MAX_CAPTURE_BYTES:
            raise DomainError(413,"CAPTURE_SIZE","Máximo 256 KiB.")
        payload.extend(part)
    image=bytes(payload)
    width,height=validate_synthetic_png(image)
    conn=scope.connection
    conn.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:orgkey,0))"),{"orgkey":str(scope.organization_id)})
    store=await run_in_threadpool(storage)
    if store:
        expired=conn.execute(text("SELECT id,b2_file_id FROM sandbox_capture_objects WHERE organization_id=:org AND profile_id=:profile AND expires_at<=now() FOR UPDATE"),params).mappings().all()
        for item in expired:
            if item["b2_file_id"]:
                try:
                    await run_in_threadpool(store.delete,object_name(item["id"]),item["b2_file_id"])
                except B2Error:
                    continue
            conn.execute(text("DELETE FROM sandbox_capture_objects WHERE organization_id=:org AND id=:id"),{**params,"id":item["id"]})
    else:
        conn.execute(text("DELETE FROM sandbox_capture_objects WHERE organization_id=:org AND expires_at<=now()"),params)
    count=conn.execute(text("SELECT count(*) FROM sandbox_capture_objects WHERE organization_id=:org AND expires_at>now()"),params).scalar_one()
    if count>=20:
        raise DomainError(409,"CAPTURE_LIMIT","Máximo 20 imágenes por cuenta de pruebas.")
    identifier=uuid4()
    encrypted=key.encrypt(image)
    values={**params,"id":identifier,"size":len(image),"width":width,"height":height,"sha":hashlib.sha256(image).hexdigest(),"posture":posture}
    if store:
        name=object_name(identifier)
        try:
            file_id=await run_in_threadpool(store.verified_put,name,encrypted)
        except (B2Error,KeyError,ValueError,TypeError):
            raise DomainError(503,"CAPTURE_UNAVAILABLE","No se pudo guardar la imagen en Backblaze.") from None
        try:
            row=conn.execute(text(f"""
              INSERT INTO sandbox_capture_objects(id,organization_id,profile_id,created_by,original_bytes,width,height,sha256_digest,ciphertext,b2_file_id,posture)
              VALUES(:id,:org,:profile,:actor,:size,:width,:height,:sha,NULL,:file_id,:posture) RETURNING {FIELDS}
            """),{**values,"file_id":file_id}).mappings().one()
        except Exception:
            try:
                await run_in_threadpool(store.delete,name,file_id)
            except B2Error:
                pass
            raise
    else:
        row=conn.execute(text(f"""
          INSERT INTO sandbox_capture_objects(id,organization_id,profile_id,created_by,original_bytes,width,height,sha256_digest,ciphertext,posture)
          VALUES(:id,:org,:profile,:actor,:size,:width,:height,:sha,:encrypted,:posture) RETURNING {FIELDS}
        """),{**values,"encrypted":encrypted}).mappings().one()
    return dict(row)


@router.get("/profiles/{profile_id}/captures",response_model=SandboxCaptureList)
def list_images(profile_id:UUID,scope:Scope,request:Request,limit:int=Query(20,ge=1,le=50),offset:int=Query(0,ge=0,le=10000)):
    cipher(request)
    params=context(scope,profile_id)
    total=scope.connection.execute(text("SELECT count(*) FROM sandbox_capture_objects WHERE organization_id=:org AND profile_id=:profile AND expires_at>now()"),params).scalar_one()
    rows=scope.connection.execute(text(f"SELECT {FIELDS} FROM sandbox_capture_objects WHERE organization_id=:org AND profile_id=:profile AND expires_at>now() ORDER BY created_at DESC,id LIMIT :limit OFFSET :offset"),{**params,"limit":limit,"offset":offset}).mappings().all()
    return {"items":[dict(row) for row in rows],"total":total}


@router.get("/profiles/{profile_id}/captures/{capture_id}")
def download(profile_id:UUID,capture_id:UUID,scope:Scope,request:Request):
    key=cipher(request)
    params=context(scope,profile_id)
    enabled=os.environ.get("CAPTURE_STORAGE")=="b2"
    fields="ciphertext,sha256_digest,b2_file_id" if enabled else "ciphertext,sha256_digest"
    row=scope.connection.execute(text(f"SELECT {fields} FROM sandbox_capture_objects WHERE organization_id=:org AND profile_id=:profile AND id=:id AND expires_at>now()"),{**params,"id":capture_id}).mappings().one_or_none()
    if row is None:
        raise DomainError(404,"NOT_FOUND","Imagen no disponible.")
    try:
        if row.get("b2_file_id"):
            store=storage()
            encrypted=store.get(row["b2_file_id"])
        else:
            encrypted=bytes(row["ciphertext"])
        data=key.decrypt(encrypted)
    except (InvalidToken,B2Error,TypeError,ValueError,KeyError):
        raise DomainError(500,"CAPTURE_UNAVAILABLE","Imagen no disponible.") from None
    if hashlib.sha256(data).hexdigest()!=row["sha256_digest"]:
        raise DomainError(500,"CAPTURE_UNAVAILABLE","Imagen no disponible.")
    return Response(data,media_type="image/png",headers={"Cache-Control":"no-store, private","X-Content-Type-Options":"nosniff"})


@router.delete("/profiles/{profile_id}/captures/{capture_id}",status_code=204)
def delete(profile_id:UUID,capture_id:UUID,scope:Scope,request:Request):
    cipher(request)
    params=context(scope,profile_id,True)
    if os.environ.get("CAPTURE_STORAGE")=="b2":
        row=scope.connection.execute(text("SELECT b2_file_id FROM sandbox_capture_objects WHERE organization_id=:org AND profile_id=:profile AND id=:id FOR UPDATE"),{**params,"id":capture_id}).mappings().one_or_none()
        if row is None:
            raise DomainError(404,"NOT_FOUND","Imagen no disponible.")
        if row["b2_file_id"]:
            try:
                storage().delete(object_name(capture_id),row["b2_file_id"])
            except (B2Error,KeyError,ValueError,TypeError):
                raise DomainError(503,"CAPTURE_UNAVAILABLE","No se pudo eliminar la imagen de Backblaze.") from None
    found=scope.connection.execute(text("DELETE FROM sandbox_capture_objects WHERE organization_id=:org AND profile_id=:profile AND id=:id RETURNING id"),{**params,"id":capture_id}).scalar_one_or_none()
    if found is None:
        raise DomainError(404,"NOT_FOUND","Imagen no disponible.")
    return Response(status_code=204)
