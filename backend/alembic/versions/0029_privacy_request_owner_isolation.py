"""Only the requester or an explicitly-granted administrator may see request metadata.

RLS acts independently of the HTTP endpoint. All environments stay synthetic;
this migration is not legal ARCO fulfillment or a patient-data authorization.
"""

from alembic import op

revision = "0029_privacy_request_owner_isolation"
down_revision = "0028_synthetic_privacy_requests"
branch_labels = None
depends_on = None

# The previous policy already enforced organization, identity, profile grant
# and a fresh explicit access row. Preserve every one of those conditions.
READ_POLICY_PREFIX = """
    organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
    AND current_setting('app.identity_verified',true)='yes'
    AND has_profile_access(profile_id)
    AND EXISTS (
      SELECT 1 FROM public.profile_access a
      WHERE a.organization_id=synthetic_privacy_requests.organization_id
        AND a.profile_id=synthetic_privacy_requests.profile_id
        AND a.user_id=NULLIF(current_setting('app.actor_id',true),'')::uuid
        AND (a.expires_at IS NULL OR a.expires_at>now())
    )
"""


def upgrade() -> None:
    # The data API role cannot SELECT user_role_assignments directly. A narrow
    # SECURITY DEFINER boolean predicate evaluates the *current* server-side
    # identity and role assignment without leaking the role table or bypassing
    # profile-grant checks in the caller's RLS policy.
    op.execute("""
        CREATE FUNCTION public.can_view_synthetic_privacy_request(requester_id uuid)
        RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
          SELECT requester_id IS NOT NULL
            AND current_setting('app.identity_verified',true)='yes'
            AND NULLIF(current_setting('app.organization_id',true),'') IS NOT NULL
            AND NULLIF(current_setting('app.actor_id',true),'') IS NOT NULL
            AND (
              requester_id=NULLIF(current_setting('app.actor_id',true),'')::uuid
              OR EXISTS (
                SELECT 1 FROM public.user_role_assignments ra
                JOIN public.users u
                  ON u.id=ra.user_id AND u.organization_id=ra.organization_id
                WHERE ra.organization_id=
                    NULLIF(current_setting('app.organization_id',true),'')::uuid
                  AND ra.user_id=
                    NULLIF(current_setting('app.actor_id',true),'')::uuid
                  AND ra.role='administrator'
                  AND (ra.expires_at IS NULL OR ra.expires_at>now())
                  AND u.account_status='active' AND NOT u.is_local_operator
              )
            )
        $$;
        REVOKE ALL ON FUNCTION public.can_view_synthetic_privacy_request(uuid)
          FROM PUBLIC,bodyvision_auth_app;
        GRANT EXECUTE ON FUNCTION public.can_view_synthetic_privacy_request(uuid)
          TO bodyvision_app;
    """)
    op.execute("DROP POLICY privacy_request_read ON public.synthetic_privacy_requests")
    op.execute(
        "CREATE POLICY privacy_request_read ON public.synthetic_privacy_requests "
        f"FOR SELECT USING ({READ_POLICY_PREFIX} "
        "AND public.can_view_synthetic_privacy_request(requested_by))"
    )
    op.execute(
        "UPDATE public.system_schema_state "
        "SET revision='0029_privacy_request_owner_isolation'"
    )


def downgrade() -> None:
    op.execute("DROP POLICY privacy_request_read ON public.synthetic_privacy_requests")
    op.execute(
        "CREATE POLICY privacy_request_read ON public.synthetic_privacy_requests "
        f"FOR SELECT USING ({READ_POLICY_PREFIX})"
    )
    op.execute("DROP FUNCTION public.can_view_synthetic_privacy_request(uuid)")
    op.execute(
        "UPDATE public.system_schema_state "
        "SET revision='0028_synthetic_privacy_requests'"
    )
