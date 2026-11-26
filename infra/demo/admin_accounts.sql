-- Hosted sandbox administrator provisioning (no clinical data, no seed patients).
ALTER TABLE public.sandbox_accounts ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'specialist' CHECK (role IN ('administrator','specialist','member','privacy_officer'));
ALTER TABLE public.sandbox_accounts ADD COLUMN IF NOT EXISTS display_name text;
UPDATE public.sandbox_accounts SET role='administrator' WHERE email='admin@gmail.com';
CREATE OR REPLACE FUNCTION public.sandbox_admin_create_account(p_digest text,p_email text,p_verifier text,p_name text,p_role text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $fn$
DECLARE new_org uuid:=gen_random_uuid(); new_actor uuid:=gen_random_uuid();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.sandbox_sessions s JOIN public.sandbox_accounts a ON a.user_id=s.user_id AND a.organization_id=s.organization_id WHERE s.digest=p_digest AND NOT s.revoked AND s.expires_at>now() AND a.role='administrator') THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 IF p_email IS NULL OR length(p_email)>254 OR p_email<>lower(p_email) OR p_email='pruebas@bodyvision.invalid' OR p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' OR p_verifier IS NULL OR p_verifier !~ '^[0-9a-f]{32}:[0-9a-f]{64}$' OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 100 OR p_role IS NULL OR p_role NOT IN ('administrator','specialist','member','privacy_officer') THEN RAISE EXCEPTION 'Invalid account' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(57240311);
 IF EXISTS(SELECT 1 FROM public.sandbox_accounts WHERE email=p_email) OR (SELECT count(*) FROM public.sandbox_accounts)>=50 THEN RETURN false; END IF;
 INSERT INTO public.organizations(id,name,synthetic) VALUES(new_org,'Espacio BodyVision',true);
 INSERT INTO public.users(id,organization_id,display_name,is_local_operator) VALUES(new_actor,new_org,trim(p_name),true);
 INSERT INTO public.metric_catalog(organization_id,code,label,unit,min_value,max_value,allowed_methods,precision,instructions,position) SELECT new_org,code,label,unit,min_value,max_value,allowed_methods,precision,instructions,position FROM public.metric_catalog WHERE organization_id='10000000-0000-4000-8000-000000000001';
 INSERT INTO public.sandbox_accounts(email,verifier,organization_id,user_id,display_name,role) VALUES(p_email,p_verifier,new_org,new_actor,trim(p_name),p_role);
 RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION public.sandbox_admin_create_account(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sandbox_admin_create_account(text,text,text,text,text) TO bodyvision_app;
REVOKE EXECUTE ON FUNCTION public.sandbox_register_account(text,text) FROM PUBLIC,bodyvision_app;
