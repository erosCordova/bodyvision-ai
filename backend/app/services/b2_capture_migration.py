"""Scoped migration of existing encrypted sandbox photos; never logs image or credentials."""
import hashlib
import logging
import os
from uuid import UUID, uuid4
from cryptography.fernet import Fernet
from sqlalchemy import text
from app.services.b2_capture_store import B2Store, B2Error, object_name

def migrate_configured_account(engine,settings):
    if os.environ.get("CAPTURE_STORAGE")!="b2":
        return
    log=logging.getLogger("bodyvision")
    try:
        store=B2Store()
        # Exercise write/read/delete using an encrypted, non-personal probe.
        cipher=Fernet(settings.sandbox_capture_key.get_secret_value().encode("ascii"))
        probe=object_name(uuid4())
        fid=store.verified_put(probe,cipher.encrypt(b"BodyVision synthetic storage verification"))
        store.delete(probe,fid)
        log.info("b2_storage_verified")
        target=os.environ.get("B2_MIGRATE_ORG")
        actor=os.environ.get("B2_MIGRATE_ACTOR")
        if not target or not actor:
            return
        target,actor=UUID(target),UUID(actor)
        def scope(conn):
            conn.execute(text("SELECT set_config('app.organization_id',:org,true)"),{"org":str(target)})
            conn.execute(text("SELECT set_config('app.actor_id',:actor,true)"),{"actor":str(actor)})
        with engine.begin() as conn:
            scope(conn)
            ids=conn.execute(text("SELECT id FROM sandbox_capture_objects WHERE organization_id=:org AND ciphertext IS NOT NULL AND expires_at>now()"),{"org":target}).scalars().all()
        migrated=0
        for identifier in ids:
            file_id=None
            try:
                with engine.begin() as conn:
                    scope(conn)
                    row=conn.execute(text("SELECT ciphertext,sha256_digest FROM sandbox_capture_objects WHERE organization_id=:org AND id=:id AND ciphertext IS NOT NULL AND expires_at>now() FOR UPDATE"),{"org":target,"id":identifier}).mappings().one_or_none()
                    if row is None:
                        continue
                    encrypted=bytes(row["ciphertext"])
                    if hashlib.sha256(cipher.decrypt(encrypted)).hexdigest()!=row["sha256_digest"]:
                        raise B2Error("Capture digest mismatch")
                    file_id=store.verified_put(object_name(identifier),encrypted)
                    updated=conn.execute(text("UPDATE sandbox_capture_objects SET b2_file_id=:file,ciphertext=NULL WHERE organization_id=:org AND id=:id AND ciphertext IS NOT NULL"),{"file":file_id,"org":target,"id":identifier})
                    if updated.rowcount!=1:
                        raise B2Error("Migration update not authorized")
                migrated+=1
            except Exception:
                # A commit error can be ambiguous: only remove upload if DB still holds original bytes.
                if file_id:
                    try:
                        with engine.begin() as conn:
                            scope(conn)
                            old=conn.execute(text("SELECT ciphertext IS NOT NULL FROM sandbox_capture_objects WHERE organization_id=:org AND id=:id"),{"org":target,"id":identifier}).scalar_one_or_none()
                        if old is True:
                            store.delete(object_name(identifier),file_id)
                    except Exception:
                        pass
                log.warning("b2_migration_record_failed")
        log.info("b2_migration_completed count=%d expected=%d",migrated,len(ids))
    except Exception as exc:
        log.warning("b2_storage_verification_failed type=%s reason=%s",type(exc).__name__,str(exc) if isinstance(exc,B2Error) else "internal")
