"""Scoped audit for private fictional server PDF exports."""

from alembic import op

revision = "0019_comparison_export"
down_revision = "0018_capture_maintenance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE FUNCTION audit_private_comparison_export(
          event_identifier uuid, correlation uuid, target_profile uuid
        ) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public AS $$
        DECLARE tenant uuid; actor uuid;
        BEGIN
          tenant := NULLIF(current_setting('app.organization_id',true),'')::uuid;
          actor := NULLIF(current_setting('app.actor_id',true),'')::uuid;
          IF tenant IS NULL OR actor IS NULL OR correlation IS NULL
            OR current_setting('app.identity_verified',true) IS DISTINCT FROM 'yes'
          THEN RAISE EXCEPTION 'Verified identity required' USING ERRCODE='42501'; END IF;
          IF NOT EXISTS (
            SELECT 1 FROM public.users u JOIN public.organizations o ON o.id=u.organization_id
            JOIN public.profile_access a ON a.user_id=u.id AND a.organization_id=o.id
            JOIN public.profiles p ON p.id=a.profile_id AND p.organization_id=o.id
            WHERE u.id=actor AND o.id=tenant AND o.synthetic
              AND u.account_status='active' AND NOT u.is_local_operator
              AND p.id=target_profile AND (a.expires_at IS NULL OR a.expires_at>now())
          ) THEN RAISE EXCEPTION 'Fictional profile access required' USING ERRCODE='42501'; END IF;
          INSERT INTO public.security_audit_events(
            id,organization_id,actor_id,correlation_id,action,resource_type,resource_id,outcome
          ) VALUES (
            event_identifier,tenant,actor,correlation,'report.export','profile',target_profile,'allowed'
          );
          RETURN true;
        END $$;
        REVOKE ALL ON FUNCTION audit_private_comparison_export(uuid,uuid,uuid)
          FROM PUBLIC,bodyvision_auth_app;
        GRANT EXECUTE ON FUNCTION audit_private_comparison_export(uuid,uuid,uuid) TO bodyvision_app;
        UPDATE system_schema_state SET revision='0019_comparison_export';
    """)


def downgrade() -> None:
    op.execute("DROP FUNCTION audit_private_comparison_export(uuid,uuid,uuid)")
    op.execute("UPDATE system_schema_state SET revision='0018_capture_maintenance'")
