"""Admin-only synthetic provisioning and private security event audit.

All writes happen through tightly scoped SECURITY DEFINER functions; the
runtime roles cannot directly INSERT or SELECT the underlying security tables.
"""

from alembic import op

revision = "0006_private_user_admin"
down_revision = "0005_login_throttle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE FUNCTION provision_synthetic_user(
          session_digest char(64), created_user uuid, created_role_id uuid,
          new_email text, new_name text, password_verifier text,
          assigned_role text, audit_event uuid, correlation uuid
        ) RETURNS uuid
        LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public AS $$
        DECLARE
          owner_org uuid;
          owner_id uuid;
          owner_role text;
        BEGIN
          SELECT resolved.org_id,resolved.actor_id,resolved.assigned_role
            INTO owner_org,owner_id,owner_role
            FROM resolve_authenticated_session(session_digest) AS resolved;
          IF owner_org IS NULL OR owner_role IS DISTINCT FROM 'administrator'
            THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';
          END IF;
          IF NOT EXISTS(
            SELECT 1 FROM organizations WHERE id=owner_org AND synthetic
          ) THEN
            RAISE EXCEPTION 'Synthetic organizations only' USING ERRCODE='42501';
          END IF;
          IF assigned_role NOT IN ('member','specialist')
            OR new_email !~ '^[a-z0-9._%+-]+@'
            OR split_part(new_email,'@',2) <> 'example.invalid'
            OR split_part(new_email,'@',3) <> ''
            OR length(new_email)>254
            OR length(btrim(new_name))<3 OR length(new_name)>100
            OR password_verifier !~ '^pbkdf2_sha256[$]600000[$][0-9a-f]{32}[$][0-9a-f]{64}$'
          THEN
            RAISE EXCEPTION 'Invalid synthetic user data' USING ERRCODE='22023';
          END IF;
          INSERT INTO users(
            id,organization_id,display_name,is_local_operator,
            email,password_hash,account_status
          ) VALUES (
            created_user,owner_org,btrim(new_name),false,
            lower(new_email),password_verifier,'active'
          );
          INSERT INTO user_role_assignments(
            id,organization_id,user_id,role,granted_by
          ) VALUES (
            created_role_id,owner_org,created_user,assigned_role,owner_id
          );
          INSERT INTO security_audit_events(
            id,organization_id,actor_id,correlation_id,action,
            resource_type,resource_id,outcome
          ) VALUES (
            audit_event,owner_org,owner_id,correlation,
            'admin.user_provisioned','user',created_user,'allowed'
          );
          RETURN created_user;
        END $$;
        REVOKE ALL ON FUNCTION provision_synthetic_user(
          char(64),uuid,uuid,text,text,text,text,uuid,uuid
        ) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION provision_synthetic_user(
          char(64),uuid,uuid,text,text,text,text,uuid,uuid
        ) TO bodyvision_auth_app;
    """)
    op.execute("""
        CREATE FUNCTION record_authenticated_security_event(
          session_digest char(64), event_id uuid, correlation uuid,
          event_name text, event_outcome text
        ) RETURNS boolean
        LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public AS $$
        DECLARE
          owner_org uuid;
          owner_id uuid;
          owner_role text;
        BEGIN
          SELECT org_id,actor_id,assigned_role
            INTO owner_org,owner_id,owner_role
            FROM resolve_authenticated_session(session_digest);
          IF owner_org IS NULL THEN RETURN false; END IF;
          IF (event_name,event_outcome) NOT IN (
            ('auth.login','allowed'),
            ('auth.logout','allowed'),
            ('admin.user_provision_denied','denied'),
            ('admin.audit_denied','denied'),
            ('admin.permission_change_denied','denied')
          ) THEN
            RAISE EXCEPTION 'Invalid audit event' USING ERRCODE='22023';
          END IF;
          INSERT INTO security_audit_events(
            id,organization_id,actor_id,correlation_id,action,
            resource_type,resource_id,outcome
          ) VALUES (
            event_id,owner_org,owner_id,correlation,event_name,
            'session',NULL,event_outcome
          );
          RETURN true;
        END $$;
        REVOKE ALL ON FUNCTION record_authenticated_security_event(
          char(64),uuid,uuid,text,text
        ) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION record_authenticated_security_event(
          char(64),uuid,uuid,text,text
        ) TO bodyvision_auth_app;
    """)
    op.execute("""
        CREATE FUNCTION private_admin_security_events(
          session_digest char(64), row_limit integer
        ) RETURNS TABLE(
          id uuid,actor_id uuid,action varchar,
          resource_type varchar,resource_id uuid,
          outcome varchar,happened_at timestamptz
        )
        LANGUAGE plpgsql STABLE SECURITY DEFINER
        SET search_path=pg_catalog,public AS $$
        DECLARE
          owner_org uuid;
          owner_role text;
        BEGIN
          SELECT org_id,assigned_role INTO owner_org,owner_role
            FROM resolve_authenticated_session(session_digest);
          IF owner_org IS NULL OR owner_role IS DISTINCT FROM 'administrator'
            THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';
          END IF;
          IF row_limit<1 OR row_limit>50
            THEN RAISE EXCEPTION 'Invalid limit' USING ERRCODE='22023';
          END IF;
          RETURN QUERY
          SELECT a.id,a.actor_id,a.action,a.resource_type,
                 a.resource_id,a.outcome,a.happened_at
          FROM security_audit_events a
          WHERE a.organization_id=owner_org
          ORDER BY a.happened_at DESC,a.id DESC LIMIT row_limit;
        END $$;
        REVOKE ALL ON FUNCTION private_admin_security_events(
          char(64),integer
        ) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION private_admin_security_events(
          char(64),integer
        ) TO bodyvision_auth_app;
    """)
    op.execute("UPDATE system_schema_state SET revision='0006_private_user_admin'")


def downgrade() -> None:
    op.execute("DROP FUNCTION private_admin_security_events(char(64),integer)")
    op.execute("DROP FUNCTION record_authenticated_security_event(char(64),uuid,uuid,text,text)")
    op.execute(
        "DROP FUNCTION provision_synthetic_user(char(64),uuid,uuid,text,text,text,text,uuid,uuid)"
    )
    op.execute("UPDATE system_schema_state SET revision='0005_login_throttle'")
