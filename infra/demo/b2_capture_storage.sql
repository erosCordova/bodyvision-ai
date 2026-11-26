-- Execute as schema owner, before enabling B2.
ALTER TABLE public.sandbox_capture_objects ADD COLUMN IF NOT EXISTS b2_file_id text;
ALTER TABLE public.sandbox_capture_objects ALTER COLUMN ciphertext DROP NOT NULL;
ALTER TABLE public.sandbox_capture_objects ADD CONSTRAINT sandbox_capture_one_storage CHECK ((ciphertext IS NULL) <> (b2_file_id IS NULL));
GRANT UPDATE (ciphertext,b2_file_id) ON public.sandbox_capture_objects TO bodyvision_app;
CREATE POLICY sandbox_capture_migrate ON public.sandbox_capture_objects FOR UPDATE TO bodyvision_app USING (organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid AND has_profile_access(profile_id,true) AND ciphertext IS NOT NULL) WITH CHECK (organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid AND has_profile_access(profile_id,true) AND ciphertext IS NULL AND b2_file_id IS NOT NULL);
