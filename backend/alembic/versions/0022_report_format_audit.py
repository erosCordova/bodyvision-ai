"""Distinguish newly generated PDF and CSV reports in the immutable audit chain."""

from alembic import op

revision = "0022_report_format_audit"
down_revision = "0021_pose_retention"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE FUNCTION audit_private_comparison_export(
          event_identifier uuid, correlation uuid, target_profile uuid, export_format text
        ) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public AS $$
        DECLARE tenant uuid; actor uuid;
        BEGIN
          IF export_format IS NULL OR export_format NOT IN ('pdf','csv') THEN
            RAISE EXCEPTION 'Unsupported report format' USING ERRCODE='22023';
          END IF;
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
            event_identifier,tenant,actor,correlation,'report.export.' || export_format,
            'profile',target_profile,'allowed'
          );
          RETURN true;
        END $$;
        REVOKE ALL ON FUNCTION audit_private_comparison_export(uuid,uuid,uuid,text)
          FROM PUBLIC,bodyvision_auth_app;
        GRANT EXECUTE ON FUNCTION audit_private_comparison_export(uuid,uuid,uuid,text)
          TO bodyvision_app;
        -- Keep historical entries untouched; the old signature is owner-only
        -- until a downgrade explicitly restores the previous application grant.
        REVOKE ALL ON FUNCTION audit_private_comparison_export(uuid,uuid,uuid)
          FROM bodyvision_app;
        UPDATE system_schema_state SET revision='0022_report_format_audit';
    """)


def downgrade() -> None:
    op.execute("""
        DROP FUNCTION audit_private_comparison_export(uuid,uuid,uuid,text);
        GRANT EXECUTE ON FUNCTION audit_private_comparison_export(uuid,uuid,uuid)
          TO bodyvision_app;
        UPDATE system_schema_state SET revision='0021_pose_retention';
    """)
