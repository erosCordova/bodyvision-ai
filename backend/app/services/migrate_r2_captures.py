"""Run in a trusted admin environment with DB owner connection and R2 secrets.
Copies existing encrypted captures, verifies the downloaded encrypted bytes and
the original image digest, then removes the PostgreSQL blob in the same row.
"""
import os
import hashlib
from cryptography.fernet import Fernet
from sqlalchemy import create_engine, text
from app.services.r2_capture_store import R2Store, object_key

def main():
    store=R2Store()
    cipher=Fernet(os.environ["SANDBOX_CAPTURE_KEY"].encode("ascii"))
    engine=create_engine(os.environ["MIGRATION_DATABASE_URL"],hide_parameters=True)
    with engine.connect() as conn:
        ids=conn.execute(text("SELECT id FROM sandbox_capture_objects WHERE ciphertext IS NOT NULL AND expires_at>now()")).scalars().all()
    migrated=0
    for identifier in ids:
        with engine.begin() as conn:
            row=conn.execute(text("SELECT ciphertext,sha256_digest FROM sandbox_capture_objects WHERE id=:id AND ciphertext IS NOT NULL AND expires_at>now() FOR UPDATE"),{"id":identifier}).mappings().one_or_none()
            if row is None:
                continue
            data=bytes(row["ciphertext"])
            if hashlib.sha256(cipher.decrypt(data)).hexdigest()!=row["sha256_digest"]:
                raise RuntimeError("Existing capture failed integrity verification.")
            key=object_key(identifier)
            store.put(key,data)
            if store.get(key)!=data:
                raise RuntimeError("R2 readback verification failed.")
            conn.execute(text("UPDATE sandbox_capture_objects SET r2_key=:key,ciphertext=NULL WHERE id=:id"),{"id":identifier,"key":key})
            migrated+=1
    print("Migrated captures:",migrated)
    engine.dispose()

if __name__=="__main__":
    main()
