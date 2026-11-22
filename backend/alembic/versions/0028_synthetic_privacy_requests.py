"""Synthetic subject-rights request intake and triage, not legal fulfillment.

No real data, no automatic erasure/export, and no unverified 'completed' state.
"""

from alembic import op

revision = "0028_synthetic_privacy_requests"
down_revision = "0027_private_idle_activity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE public.synthetic_privacy_requests (
          id uuid PRIMARY KEY,
          organization_id uuid NOT NULL,
          profile_id uuid NOT NULL,
          request_type text NOT NULL CHECK (request_type IN
            ('access','rectification','cancellation','opposition','export')),
          status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','in_review')),
          requested_by uuid NOT NULL,
          received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
          review_target_at timestamptz NOT NULL,
          review_started_at timestamptz,
          reviewed_by uuid,
          FOREIGN KEY (organization_id,profile_id)
            REFERENCES public.profiles(organization_id,id) ON DELETE CASCADE,
          FOREIGN KEY (organization_id,requested_by)
            REFERENCES public.users(organization_id,id),
          FOREIGN KEY (organization_id,reviewed_by)
            REFERENCES public.users(organization_id,id),
          CHECK (
            (status='received' AND review_started_at IS NULL AND reviewed_by IS NULL)
            OR (status='in_review' AND review_started_at IS NOT NULL
                AND reviewed_by IS NOT NULL)
          ),
          CHECK (review_target_at>received_at)
        );
        CREATE UNIQUE INDEX privacy_one_open_request_per_type
          ON public.synthetic_privacy_requests(organization_id,profile_id,request_type)
          WHERE status IN ('received','in_review');
        CREATE INDEX privacy_request_triage
          ON public.synthetic_privacy_requests(organization_id,status,received_at DESC,id DESC);
        ALTER TABLE public.synthetic_privacy_requests ENABLE ROW LEVEL SECURITY;
        CREATE POLICY privacy_request_read ON public.synthetic_privacy_requests
          FOR SELECT USING (
            organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
            AND current_setting('app.identity_verified',true)='yes'
            AND has_profile_access(profile_id)
          );
        CREATE POLICY privacy_request_submit ON public.synthetic_privacy_requests
          FOR INSERT WITH CHECK (
            organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
            AND requested_by=NULLIF(current_setting('app.actor_id',true),'')::uuid
            AND current_setting('app.identity_verified',true)='yes'
            AND has_profile_access(profile_id) AND status='received'
            AND review_started_at IS NULL AND reviewed_by IS NULL
            AND EXISTS (SELECT 1 FROM public.organizations o
              WHERE o.id=organization_id AND o.synthetic)
          );
        REVOKE ALL ON public.synthetic_privacy_requests
          FROM PUBLIC,bodyvision_app,bodyvision_auth_app;
        GRANT SELECT,INSERT ON public.synthetic_privacy_requests TO bodyvision_app;
    """)
    op.execute("""
        CREATE FUNCTION public.audit_synthetic_privacy_request(
          event_identifier uuid,correlation uuid,target_profile uuid,event_name text
        ) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE tenant uuid; actor uuid; administrator boolean;
        BEGIN
          tenant:=NULLIF(current_setting('app.organization_id',true),'')::uuid;
          actor:=NULLIF(current_setting('app.actor_id',true),'')::uuid;
          IF tenant IS NULL OR actor IS NULL OR correlation IS NULL
            OR event_identifier IS NULL
            OR current_setting('app.identity_verified',true) IS DISTINCT FROM 'yes'
            OR event_name NOT IN (
              'privacy.request.created','privacy.request.listed',
              'privacy.queue.listed','privacy.request.review_started'
            )
            OR NOT EXISTS (
              SELECT 1 FROM public.users u JOIN public.organizations o
                ON o.id=u.organization_id
              WHERE u.id=actor AND u.organization_id=tenant
                AND u.account_status='active' AND NOT u.is_local_operator
                AND o.synthetic
            ) THEN
            RAISE EXCEPTION 'Verified synthetic privacy identity required'
              USING ERRCODE='42501';
          END IF;
          administrator:=EXISTS (
            SELECT 1 FROM public.user_role_assignments r
            WHERE r.organization_id=tenant AND r.user_id=actor
              AND r.role='administrator'
              AND (r.expires_at IS NULL OR r.expires_at>now())
          );
          IF event_name='privacy.queue.listed' THEN
            IF target_profile IS NOT NULL OR NOT administrator THEN
              RAISE EXCEPTION 'Privacy queue scope denied' USING ERRCODE='42501';
            END IF;
          ELSIF target_profile IS NULL
            OR NOT has_profile_access(target_profile,
              event_name='privacy.request.review_started')
            OR (event_name='privacy.request.review_started' AND NOT administrator)
          THEN
            RAISE EXCEPTION 'Privacy profile scope denied' USING ERRCODE='42501';
          END IF;
          INSERT INTO public.security_audit_events(
            id,organization_id,actor_id,correlation_id,
            action,resource_type,resource_id,outcome
          ) VALUES (
            event_identifier,tenant,actor,correlation,event_name,
            'profile',target_profile,'allowed'
          );
          RETURN true;
        END $$;
        REVOKE ALL ON FUNCTION public.audit_synthetic_privacy_request(
          uuid,uuid,uuid,text) FROM PUBLIC,bodyvision_auth_app;
        GRANT EXECUTE ON FUNCTION public.audit_synthetic_privacy_request(
          uuid,uuid,uuid,text) TO bodyvision_app;
    """)
    op.execute("""
        CREATE FUNCTION public.start_synthetic_privacy_review(
          target_request uuid,event_identifier uuid,correlation uuid
        ) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE tenant uuid; actor uuid; target_profile uuid; current_state text;
        BEGIN
          tenant:=NULLIF(current_setting('app.organization_id',true),'')::uuid;
          actor:=NULLIF(current_setting('app.actor_id',true),'')::uuid;
          IF tenant IS NULL OR actor IS NULL OR correlation IS NULL
            OR event_identifier IS NULL OR target_request IS NULL
            OR current_setting('app.identity_verified',true) IS DISTINCT FROM 'yes'
          THEN RAISE EXCEPTION 'Verified privacy review required'
            USING ERRCODE='42501'; END IF;
          SELECT r.profile_id,r.status INTO target_profile,current_state
            FROM public.synthetic_privacy_requests r
            WHERE r.id=target_request AND r.organization_id=tenant
            FOR UPDATE;
          IF NOT FOUND THEN RETURN false; END IF;
          PERFORM public.audit_synthetic_privacy_request(
            event_identifier,correlation,target_profile,'privacy.request.review_started');
          IF current_state<>'received' THEN
            RAISE EXCEPTION 'Already under review' USING ERRCODE='23505';
          END IF;
          UPDATE public.synthetic_privacy_requests r
            SET status='in_review',review_started_at=clock_timestamp(),reviewed_by=actor
            WHERE r.id=target_request AND r.organization_id=tenant;
          RETURN true;
        END $$;
        REVOKE ALL ON FUNCTION public.start_synthetic_privacy_review(
          uuid,uuid,uuid) FROM PUBLIC,bodyvision_auth_app;
        GRANT EXECUTE ON FUNCTION public.start_synthetic_privacy_review(
          uuid,uuid,uuid) TO bodyvision_app;
        UPDATE public.system_schema_state
          SET revision='0028_synthetic_privacy_requests';
    """)


def downgrade() -> None:
    op.execute("""
        DROP FUNCTION public.start_synthetic_privacy_review(uuid,uuid,uuid);
        DROP FUNCTION public.audit_synthetic_privacy_request(uuid,uuid,uuid,text);
        DROP TABLE public.synthetic_privacy_requests;
        UPDATE public.system_schema_state
          SET revision='0027_private_idle_activity';
    """)
