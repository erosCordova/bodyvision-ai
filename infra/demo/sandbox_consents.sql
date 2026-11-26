CREATE TABLE IF NOT EXISTS public.sandbox_consents (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 profile_id uuid NOT NULL,
 purpose text NOT NULL CHECK (purpose IN ('images','reconstruction','analysis','sharing','camera')),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 accepted_at timestamptz,
 expires_at timestamptz,
 accepted_by uuid,
 revoked_at timestamptz,
 revoked_by uuid,
 version text NOT NULL DEFAULT 'sandbox-v1' CHECK (version='sandbox-v1'),
 FOREIGN KEY (organization_id,profile_id) REFERENCES public.profiles(organization_id,id),
 FOREIGN KEY (organization_id,created_by) REFERENCES public.users(organization_id,id),
 FOREIGN KEY (organization_id,accepted_by) REFERENCES public.users(organization_id,id),
 FOREIGN KEY (organization_id,revoked_by) REFERENCES public.users(organization_id,id),
 CHECK ((accepted_at IS NULL AND accepted_by IS NULL AND expires_at IS NULL) OR (accepted_at IS NOT NULL AND accepted_by IS NOT NULL AND expires_at>accepted_at)),
 CHECK (status<>'accepted' OR accepted_at IS NOT NULL),
 CHECK ((status='revoked')=(revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);
ALTER TABLE public.sandbox_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY sandbox_consents_read ON public.sandbox_consents FOR SELECT TO bodyvision_app USING (organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid AND public.has_profile_access(profile_id));
CREATE POLICY sandbox_consents_insert ON public.sandbox_consents FOR INSERT TO bodyvision_app WITH CHECK (organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid AND created_by=NULLIF(current_setting('app.actor_id',true),'')::uuid AND status='pending' AND public.has_profile_access(profile_id,true));
CREATE POLICY sandbox_consents_update ON public.sandbox_consents FOR UPDATE TO bodyvision_app USING (organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid AND public.has_profile_access(profile_id,true)) WITH CHECK (organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid AND public.has_profile_access(profile_id,true));
GRANT SELECT,INSERT ON public.sandbox_consents TO bodyvision_app;
GRANT UPDATE (status,accepted_at,accepted_by,expires_at,revoked_at,revoked_by) ON public.sandbox_consents TO bodyvision_app;
CREATE INDEX IF NOT EXISTS sandbox_consents_profile_idx ON public.sandbox_consents(organization_id,profile_id,created_at DESC);
