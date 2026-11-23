"""Synthetic privacy officer: MFA, scoped triage/consent revocation, no clinical data."""

from sqlalchemy import text

from alembic import op

revision = "0030_private_privacy_officer"
down_revision = "0029_privacy_request_isolation"
branch_labels = None
depends_on = None

CLINICAL_TABLES = (
    "profiles",
    "users",
    "measurements",
    "idempotency_keys",
    "simulation_scenarios",
    "simulation_request_keys",
    "synthetic_capture_objects",
    "synthetic_pose_summaries",
    "pose_summary_request_keys",
)

# Change only the named, reviewed predicates, preserving subsequent password,
# session and audit hardening in the current database function definitions.
CHANGES = (
    (
        "provision_synthetic_user(char(64),uuid,uuid,text,text,text,text,uuid,uuid)",
        "assigned_role NOT IN ('member','specialist')",
        "assigned_role NOT IN ('member','specialist','privacy_officer')",
    ),
    (
        "private_admin_users(char(64),text,integer,integer)",
        "r.role IN ('member','specialist')",
        "r.role IN ('member','specialist','privacy_officer')",
    ),
    (
        "set_synthetic_account_status(char(64),uuid,text,text,uuid,uuid)",
        "a.role IN ('member','specialist')",
        "a.role IN ('member','specialist','privacy_officer')",
    ),
    (
        "reset_synthetic_password(char(64),uuid,text,text,uuid,uuid)",
        "r.role IN ('member','specialist')",
        "r.role IN ('member','specialist','privacy_officer')",
    ),
    (
        "private_mfa_snapshot(uuid,uuid,text)",
        "r.role IN ('administrator','specialist')",
        "r.role IN ('administrator','specialist','privacy_officer')",
    ),
    (
        "private_mfa_transition(uuid,uuid,text,text,text,bigint,uuid,text,jsonb,uuid,uuid)",
        "r.role IN ('administrator','specialist')",
        "r.role IN ('administrator','specialist','privacy_officer')",
    ),
    (
        "private_mfa_reset_with_recovery(uuid,uuid,text,uuid,text,text,uuid,uuid)",
        "r.role IN ('administrator','specialist')",
        "r.role IN ('administrator','specialist','privacy_officer')",
    ),
    (
        "manage_private_profile_permission(char(64),uuid,uuid,text,uuid,uuid,uuid)",
        "IF subject_role='member' AND requested_level IN ('write','manage')",
        "IF (subject_role='member' AND requested_level IN ('write','manage')) "
        "OR (subject_role='privacy_officer' AND requested_level='write')",
    ),
    (
        "audit_synthetic_privacy_request(uuid,uuid,uuid,text)",
        "AND r.role='administrator'",
        "AND (r.role='administrator' OR (r.role='privacy_officer' "
        "AND public.private_privacy_session_verified()))",
    ),
    (
        "audit_synthetic_privacy_request(uuid,uuid,uuid,text)",
        "AND (event_name<>'privacy.request.review_started'\n"
        "                  OR a.access_level IN ('write','manage'))",
        "AND (event_name<>'privacy.request.review_started' OR "
        "(a.access_level IN ('write','manage') AND "
        "(NOT public.is_private_privacy_actor() OR a.access_level='manage')))",
    ),
    (
        "can_view_synthetic_privacy_request(uuid)",
        "AND ra.role='administrator'",
        "AND (ra.role='administrator' OR (ra.role='privacy_officer' "
        "AND public.private_privacy_session_verified()))",
    ),
    (
        "can_view_synthetic_privacy_request(uuid)",
        "SELECT requester_id IS NOT NULL",
        "SELECT requester_id IS NOT NULL AND "
        "(NOT public.is_private_privacy_actor() OR public.private_privacy_session_verified())",
    ),
    (
        "private_profile_consents(char(64),uuid,text,text,uuid,uuid,uuid,uuid)",
        "writer := actor_role IN ('administrator','specialist')\n"
        "            AND grant_level IN ('write','manage');",
        "writer := (actor_role IN ('administrator','specialist') "
        "AND grant_level IN ('write','manage')) OR "
        "(actor_role='privacy_officer' AND grant_level='manage' "
        "AND public.private_mfa_session_verified(session_digest));\n"
        "          IF actor_role='privacy_officer' AND (operation='accept' "
        "OR NOT public.private_mfa_session_verified(session_digest)) "
        "THEN RETURN jsonb_build_object('error','forbidden'); END IF;",
    ),
    (
        "private_profile_consents(char(64),uuid,text,text,uuid,uuid,uuid,uuid)",
        "'can_record',writer AND profile_status='active'",
        "'can_record',writer AND actor_role<>'privacy_officer' AND profile_status='active'",
    ),
)


def _rewrite(signature: str, old: str, new: str) -> None:
    definition = (
        op.get_bind()
        .execute(
            text("SELECT pg_get_functiondef(CAST(:signature AS regprocedure))"),
            {"signature": "public." + signature},
        )
        .scalar_one()
    )
    if definition.count(old) != 1:
        raise RuntimeError("Privacy officer migration predicate mismatch: " + signature)
    op.execute(definition.replace(old, new, 1))


def upgrade() -> None:
    op.execute("""
        ALTER TABLE public.user_role_assignments DROP CONSTRAINT user_role_assignments_role_check;
        ALTER TABLE public.user_role_assignments ADD CONSTRAINT user_role_assignments_role_check
          CHECK (role IN ('administrator','specialist','member','privacy_officer'));

        -- Classify stale assignments too: an expired privacy role and an old
        -- broad grant must never turn into clinical-data access via SQL.
        CREATE FUNCTION public.is_private_privacy_actor() RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
          SELECT EXISTS(SELECT 1 FROM public.user_role_assignments r
            WHERE r.organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
              AND r.user_id=NULLIF(current_setting('app.actor_id',true),'')::uuid
              AND r.role='privacy_officer')
        $$;
        CREATE FUNCTION public.private_privacy_session_verified() RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
          SELECT current_setting('app.identity_verified',true)='yes' AND EXISTS(
            SELECT 1 FROM public.resolve_authenticated_session(
              NULLIF(current_setting('app.session_digest',true),'')::char(64)) s
            WHERE s.org_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
              AND s.actor_id=NULLIF(current_setting('app.actor_id',true),'')::uuid
              AND s.assigned_role='privacy_officer'
              AND public.private_mfa_session_verified(
                NULLIF(current_setting('app.session_digest',true),'')::char(64)))
        $$;
        CREATE FUNCTION public.private_privacy_profile_labels()
        RETURNS TABLE(id uuid,organization_id uuid,display_code varchar,can_review boolean)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
          SELECT p.id,p.organization_id,p.display_code,
            public.has_profile_access(p.id,true) AND (
              EXISTS(SELECT 1 FROM public.user_role_assignments r
                WHERE r.organization_id=p.organization_id
                  AND r.user_id=NULLIF(current_setting('app.actor_id',true),'')::uuid
                  AND r.role='administrator' AND (r.expires_at IS NULL OR r.expires_at>now()))
              OR (public.private_privacy_session_verified() AND EXISTS(
                SELECT 1 FROM public.profile_access a WHERE a.organization_id=p.organization_id
                  AND a.profile_id=p.id
                  AND a.user_id=NULLIF(current_setting('app.actor_id',true),'')::uuid
                  AND a.access_level='manage' AND (a.expires_at IS NULL OR a.expires_at>now()))))
          FROM public.profiles p
          WHERE p.organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
            AND current_setting('app.identity_verified',true)='yes'
            AND public.has_profile_access(p.id)
            AND (NOT public.is_private_privacy_actor()
                 OR public.private_privacy_session_verified())
        $$;
    """)
    for signature in (
        "is_private_privacy_actor()",
        "private_privacy_session_verified()",
        "private_privacy_profile_labels()",
    ):
        op.execute(f"REVOKE ALL ON FUNCTION public.{signature} FROM PUBLIC,bodyvision_auth_app")
        op.execute(f"GRANT EXECUTE ON FUNCTION public.{signature} TO bodyvision_app")
    for table in CLINICAL_TABLES:
        op.execute(f"""CREATE POLICY privacy_officer_no_clinical ON public.{table}
          AS RESTRICTIVE TO bodyvision_app
          USING (NOT public.is_private_privacy_actor())
          WITH CHECK (NOT public.is_private_privacy_actor())""")
    op.execute("""CREATE POLICY privacy_officer_no_submission
      ON public.synthetic_privacy_requests AS RESTRICTIVE FOR INSERT TO bodyvision_app
      WITH CHECK (NOT public.is_private_privacy_actor())""")
    for signature, old, new in CHANGES:
        _rewrite(signature, old, new)
    op.execute("UPDATE public.system_schema_state SET revision='0030_private_privacy_officer'")


def downgrade() -> None:
    # Do not erase accounts, rewrite their roles, or restore old constraints
    # while they still exist. Disposable CI fixtures remove their own actors.
    if (
        op.get_bind()
        .execute(
            text(
                "SELECT EXISTS(SELECT 1 FROM public.user_role_assignments "
                "WHERE role='privacy_officer')"
            )
        )
        .scalar_one()
    ):
        raise RuntimeError("Privacy officer assignments remain; refusing destructive downgrade")
    for signature, old, new in reversed(CHANGES):
        _rewrite(signature, new, old)
    for table in CLINICAL_TABLES:
        op.execute(f"DROP POLICY privacy_officer_no_clinical ON public.{table}")
    op.execute("DROP POLICY privacy_officer_no_submission ON public.synthetic_privacy_requests")
    op.execute("""
        DROP FUNCTION public.private_privacy_profile_labels();
        DROP FUNCTION public.private_privacy_session_verified();
        DROP FUNCTION public.is_private_privacy_actor();
        ALTER TABLE public.user_role_assignments DROP CONSTRAINT user_role_assignments_role_check;
        ALTER TABLE public.user_role_assignments ADD CONSTRAINT user_role_assignments_role_check
          CHECK (role IN ('administrator','specialist','member'));
        UPDATE public.system_schema_state SET revision='0029_privacy_request_isolation';
    """)
