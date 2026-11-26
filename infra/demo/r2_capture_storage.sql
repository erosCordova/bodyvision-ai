-- Apply as database owner before activating CAPTURE_STORAGE=r2.
BEGIN;
ALTER TABLE public.sandbox_capture_objects ADD COLUMN IF NOT EXISTS r2_key text;
ALTER TABLE public.sandbox_capture_objects ALTER COLUMN ciphertext DROP NOT NULL;
ALTER TABLE public.sandbox_capture_objects ADD CONSTRAINT capture_storage_exactly_one CHECK ((ciphertext IS NULL) <> (r2_key IS NULL));
ALTER TABLE public.sandbox_capture_objects ADD CONSTRAINT capture_r2_key_format CHECK (r2_key IS NULL OR r2_key = 'captures/' || id::text || '.fernet');
COMMIT;
