"""Time-limited synthetic expediente grants and auditable revocation.

A platform administrator may assign scoped profile access to an eligible
synthetic user, but cannot grant access to their own account. The operation
and its minimal audit trail are committed atomically.
"""

from alembic import op

revision = "0008_profile_permissions"
down_revision = "0007_profile_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE private_profile_permission_changes (
          event_id uuid PRIMARY KEY REFERENCES security_audit_events(id),
          organization_id uuid NOT NULL REFERENCES organizations(id),
          profile_id uuid NOT NULL,
          subject_user_id uuid NOT NULL,
          previous_level varchar(10),
          new_level varchar(10),
          happened_at timestamptz NOT NULL DEFAULT now(),
          FOREIGN KEY(organization_id,profile_id) REFERENCES profiles(organization_id,id),
          FOREIGN KEY(organization_id,subject_user_id) REFERENCES users(organization_id,id),
          CHECK(previous_level IS NULL OR previous_level IN ('read','write','manage')),
          CHECK(new_level IS NULL OR new_level IN ('read','write','manage'))
        );
        ALTER TABLE private_profile_permission_changes ENABLE ROW LEVEL SECURITY;
        REVOKE ALL ON private_profile_permission_changes
          FROM PUBLIC,bodyvision_app,bodyvision_auth_app;
    """)
    op.execute("""
        CREATE FUNCTION manage_private_profile_permission(
          session_digest char(64), profile_uuid uuid, subject_uuid uuid,
          requested_level text, access_identifier uuid,
          event_identifier uuid, correlation uuid
        ) RETURNS text
        LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public AS $$
        DECLARE
          owner_org uuid;
          owner_id uuid;
          owner_role text;
          subject_role text;
          existing_level text;
          changed_action text;
        BEGIN
          SELECT resolved.org_id,resolved.actor_id,resolved.assigned_role
            INTO owner_org,owner_id,owner_role
          FROM resolve_authenticated_session(session_digest) AS resolved;
          IF owner_org IS NULL OR owner_role IS DISTINCT FROM 'administrator'
            THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';
          END IF;
          IF subject_uuid=owner_id THEN RETURN 'not-found'; END IF;
          IF requested_level IS NOT NULL
            AND requested_level NOT IN ('read','write','manage')
            THEN RAISE EXCEPTION 'Invalid access level' USING ERRCODE='22023';
          END IF;
          IF NOT EXISTS(
            SELECT 1 FROM profiles p JOIN organizations o ON o.id=p.organization_id
            WHERE p.organization_id=owner_org AND p.id=profile_uuid AND o.synthetic
              AND (requested_level IS NULL OR p.status='active')
          ) THEN RETURN 'not-found'; END IF;
          SELECT r.role INTO subject_role FROM users u
            JOIN user_role_assignments r
              ON r.user_id=u.id AND r.organization_id=u.organization_id
          WHERE u.id=subject_uuid AND u.organization_id=owner_org
            AND u.account_status='active' AND NOT u.is_local_operator
            AND (r.expires_at IS NULL OR r.expires_at>now())
          ORDER BY CASE r.role WHEN 'administrator' THEN 1
            WHEN 'specialist' THEN 2 ELSE 3 END LIMIT 1;
          IF subject_role IS NULL THEN RETURN 'not-found'; END IF;
          IF subject_role='member' AND requested_level IN ('write','manage')
            THEN RETURN 'not-found';
          END IF;

          SELECT a.access_level INTO existing_level FROM profile_access a
          WHERE a.organization_id=owner_org AND a.profile_id=profile_uuid
            AND a.user_id=subject_uuid FOR UPDATE;
          IF requested_level IS NULL THEN
            IF existing_level IS NULL THEN RETURN 'not-found'; END IF;
            DELETE FROM profile_access
             WHERE organization_id=owner_org AND profile_id=profile_uuid
               AND user_id=subject_uuid;
            changed_action := 'profile.permission_revoked';
          ELSE
            INSERT INTO profile_access(
              id,organization_id,profile_id,user_id,access_level,expires_at
            ) VALUES (
              access_identifier,owner_org,profile_uuid,subject_uuid,
              requested_level,now()+interval '30 days'
            ) ON CONFLICT(organization_id,profile_id,user_id)
              DO UPDATE SET access_level=excluded.access_level,
                expires_at=excluded.expires_at;
            changed_action := 'profile.permission_granted';
          END IF;
          INSERT INTO security_audit_events(
            id,organization_id,actor_id,correlation_id,action,
            resource_type,resource_id,outcome
          ) VALUES (
            event_identifier,owner_org,owner_id,correlation,changed_action,
            'profile',profile_uuid,'allowed'
          );
          INSERT INTO private_profile_permission_changes(
            event_id,organization_id,profile_id,subject_user_id,
            previous_level,new_level
          ) VALUES (
            event_identifier,owner_org,profile_uuid,subject_uuid,
            existing_level,requested_level
          );
          RETURN CASE WHEN requested_level IS NULL THEN 'revoked' ELSE 'granted' END;
        END $$;
        REVOKE ALL ON FUNCTION manage_private_profile_permission(
          char(64),uuid,uuid,text,uuid,uuid,uuid
        ) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION manage_private_profile_permission(
          char(64),uuid,uuid,text,uuid,uuid,uuid
        ) TO bodyvision_auth_app;
    """)
    op.execute("UPDATE system_schema_state SET revision='0008_profile_permissions'")


def downgrade() -> None:
    op.execute(
        "DROP FUNCTION manage_private_profile_permission(char(64),uuid,uuid,text,uuid,uuid,uuid)"
    )
    op.execute("DROP TABLE private_profile_permission_changes")
    op.execute("UPDATE system_schema_state SET revision='0007_profile_audit'")
