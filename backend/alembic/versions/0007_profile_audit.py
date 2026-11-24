"""Transactional, minimal audit for authenticated profile operations.

Only the verified private data-role session may emit an allowed profile event.
The event is committed or rolled back together with the expediente operation.
No medical values, request bodies, tokens or personal data are stored here.
"""

from alembic import op

revision = "0007_profile_audit"
down_revision = "0006_private_user_admin"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE FUNCTION record_private_profile_event(
          event_identifier uuid, correlation uuid, target_profile uuid, event_name text
        ) RETURNS boolean
        LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public AS $$
        DECLARE
          tenant uuid;
          actor uuid;
          requires_write boolean;
        BEGIN
          tenant := NULLIF(current_setting('app.organization_id',true),'')::uuid;
          actor := NULLIF(current_setting('app.actor_id',true),'')::uuid;
          IF tenant IS NULL OR actor IS NULL
             OR current_setting('app.identity_verified',true) IS DISTINCT FROM 'yes'
          THEN
             RAISE EXCEPTION 'Verified identity required' USING ERRCODE='42501';
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM users u JOIN organizations o ON o.id=u.organization_id
            WHERE u.id=actor AND u.organization_id=tenant AND o.synthetic
              AND u.account_status='active' AND NOT u.is_local_operator
          ) THEN
            RAISE EXCEPTION 'Active synthetic identity required' USING ERRCODE='42501';
          END IF;
          IF event_name NOT IN (
            'profile.list','profile.read','profile.create','profile.update',
            'profile.archive','measurement.list','measurement.read',
            'measurement.create','measurement.correct','analytics.read'
          ) THEN
            RAISE EXCEPTION 'Unknown audit event' USING ERRCODE='22023';
          END IF;
          IF event_name='profile.list' THEN
            IF target_profile IS NOT NULL
              THEN RAISE EXCEPTION 'Invalid list target' USING ERRCODE='22023';
            END IF;
          ELSE
            IF target_profile IS NULL
              THEN RAISE EXCEPTION 'Profile target required' USING ERRCODE='22023';
            END IF;
            requires_write := event_name IN (
              'profile.create','profile.update','profile.archive',
              'measurement.create','measurement.correct'
            );
            IF NOT EXISTS (
              SELECT 1 FROM profile_access a
              JOIN profiles p ON p.id=a.profile_id
                AND p.organization_id=a.organization_id
              WHERE a.organization_id=tenant AND a.profile_id=target_profile
                AND a.user_id=actor
                AND (a.expires_at IS NULL OR a.expires_at>now())
                AND (NOT requires_write OR a.access_level IN ('write','manage'))
            ) THEN
              RAISE EXCEPTION 'Profile access denied' USING ERRCODE='42501';
            END IF;
            IF requires_write AND NOT EXISTS (
              SELECT 1 FROM user_role_assignments r
              WHERE r.organization_id=tenant AND r.user_id=actor
                AND r.role IN ('administrator','specialist')
                AND (r.expires_at IS NULL OR r.expires_at>now())
            ) THEN
              RAISE EXCEPTION 'Write role denied' USING ERRCODE='42501';
            END IF;
          END IF;
          INSERT INTO security_audit_events(
            id,organization_id,actor_id,correlation_id,
            action,resource_type,resource_id,outcome
          ) VALUES (
            event_identifier,tenant,actor,correlation,event_name,
            'profile',target_profile,'allowed'
          );
          RETURN true;
        END $$;
        REVOKE ALL ON FUNCTION record_private_profile_event(
          uuid,uuid,uuid,text
        ) FROM PUBLIC,bodyvision_auth_app;
        GRANT EXECUTE ON FUNCTION record_private_profile_event(
          uuid,uuid,uuid,text
        ) TO bodyvision_app;
    """)
    op.execute("UPDATE system_schema_state SET revision='0007_profile_audit'")


def downgrade() -> None:
    op.execute("DROP FUNCTION record_private_profile_event(uuid,uuid,uuid,text)")
    op.execute("UPDATE system_schema_state SET revision='0006_private_user_admin'")
