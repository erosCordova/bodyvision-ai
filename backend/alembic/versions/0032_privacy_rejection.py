"""Audited rejection of synthetic privacy requests, not legal fulfillment."""

from alembic import op
from sqlalchemy import text

revision = "0032_privacy_rejection"
down_revision = "0031_private_audit_export"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE public.synthetic_privacy_requests
          DROP CONSTRAINT synthetic_privacy_requests_status_check,
          DROP CONSTRAINT synthetic_privacy_requests_check,
          ADD COLUMN rejected_at timestamptz,
          ADD COLUMN rejected_by uuid,
          ADD COLUMN rejection_reason text,
          ADD FOREIGN KEY (organization_id,rejected_by)
            REFERENCES public.users(organization_id,id),
          ADD CONSTRAINT privacy_request_status_v2
            CHECK (status IN ('received','in_review','rejected')),
          ADD CONSTRAINT privacy_request_lifecycle_v2 CHECK (
            (status='received' AND review_started_at IS NULL AND reviewed_by IS NULL
              AND rejected_at IS NULL AND rejected_by IS NULL AND rejection_reason IS NULL)
            OR (status='in_review' AND review_started_at IS NOT NULL AND reviewed_by IS NOT NULL
              AND rejected_at IS NULL AND rejected_by IS NULL AND rejection_reason IS NULL)
            OR (status='rejected' AND review_started_at IS NOT NULL AND reviewed_by IS NOT NULL
              AND rejected_at IS NOT NULL AND rejected_by IS NOT NULL
              AND rejection_reason IS NOT NULL AND rejection_reason IN
                ('invalid_synthetic_request','withdrawn_by_requester','duplicate_review')
              AND rejected_at>=review_started_at)
          );
        CREATE FUNCTION public.reject_synthetic_privacy_request(
          target_request uuid,reason text,event_identifier uuid,correlation uuid
        ) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE tenant uuid; actor uuid; target_profile uuid; current_state text;
        BEGIN
          tenant:=NULLIF(current_setting('app.organization_id',true),'')::uuid;
          actor:=NULLIF(current_setting('app.actor_id',true),'')::uuid;
          IF tenant IS NULL OR actor IS NULL OR correlation IS NULL
            OR event_identifier IS NULL OR target_request IS NULL OR reason IS NULL
            OR reason NOT IN
              ('invalid_synthetic_request','withdrawn_by_requester','duplicate_review')
            OR current_setting('app.identity_verified',true) IS DISTINCT FROM 'yes'
            OR NOT EXISTS (
              SELECT 1 FROM public.users u JOIN public.organizations o
                ON o.id=u.organization_id
              WHERE u.id=actor AND u.organization_id=tenant
                AND u.account_status='active' AND NOT u.is_local_operator AND o.synthetic
            ) THEN
            RAISE EXCEPTION 'Verified synthetic privacy review required' USING ERRCODE='42501';
          END IF;
          SELECT r.profile_id,r.status INTO target_profile,current_state
            FROM public.synthetic_privacy_requests r
            WHERE r.id=target_request AND r.organization_id=tenant FOR UPDATE;
          IF NOT FOUND OR NOT EXISTS (
            SELECT 1 FROM public.private_privacy_profile_labels() p
              WHERE p.id=target_profile AND p.organization_id=tenant AND p.can_review
          ) THEN RETURN false; END IF;
          IF current_state<>'in_review' THEN
            RAISE EXCEPTION 'Request is not under review' USING ERRCODE='23505';
          END IF;
          UPDATE public.synthetic_privacy_requests
            SET status='rejected',rejected_at=clock_timestamp(),rejected_by=actor,
                rejection_reason=reason
            WHERE id=target_request AND organization_id=tenant;
          INSERT INTO public.security_audit_events(
            id,organization_id,actor_id,correlation_id,action,resource_type,resource_id,outcome
          ) VALUES (
            event_identifier,tenant,actor,correlation,'privacy.request.rejected',
            'profile',target_profile,'allowed'
          );
          RETURN true;
        END $$;
        REVOKE ALL ON FUNCTION public.reject_synthetic_privacy_request(uuid,text,uuid,uuid)
          FROM PUBLIC,bodyvision_auth_app;
        GRANT EXECUTE ON FUNCTION public.reject_synthetic_privacy_request(uuid,text,uuid,uuid)
          TO bodyvision_app;
        UPDATE public.system_schema_state SET revision='0032_privacy_rejection';
    """)


def downgrade() -> None:
    if op.get_bind().execute(
        text("SELECT EXISTS(SELECT 1 FROM public.synthetic_privacy_requests WHERE status='rejected')")
    ).scalar_one():
        raise RuntimeError("Rejected privacy requests remain; refusing destructive downgrade")
    op.execute("""
        DROP FUNCTION public.reject_synthetic_privacy_request(uuid,text,uuid,uuid);
        ALTER TABLE public.synthetic_privacy_requests
          DROP CONSTRAINT privacy_request_lifecycle_v2,
          DROP CONSTRAINT privacy_request_status_v2,
          DROP COLUMN rejected_at,
          DROP COLUMN rejected_by,
          DROP COLUMN rejection_reason,
          ADD CONSTRAINT synthetic_privacy_requests_status_check
            CHECK (status IN ('received','in_review')),
          ADD CONSTRAINT synthetic_privacy_requests_check CHECK (
            (status='received' AND review_started_at IS NULL AND reviewed_by IS NULL)
            OR (status='in_review' AND review_started_at IS NOT NULL AND reviewed_by IS NOT NULL)
          );
        UPDATE public.system_schema_state SET revision='0031_private_audit_export';
    """)
