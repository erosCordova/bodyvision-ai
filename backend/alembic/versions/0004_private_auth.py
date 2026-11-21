"""Private authenticated API primitives with distinct database privileges.

The public synthetic demo cannot enable this API. The auth database role has
only the grants needed for login lookup and session issuance; session resolution
and logout are implemented as narrow SECURITY DEFINER functions.
"""

from alembic import op

revision = "0004_private_auth"
down_revision = "0003_identity_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A NOLOGIN default is safe for demo environments. Local CI creates
    # a LOGIN role before migration, using an isolated disposable database.
    op.execute("""
        DO $$
        BEGIN
          IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='bodyvision_auth_app') THEN
            CREATE ROLE bodyvision_auth_app NOLOGIN NOSUPERUSER NOCREATEDB
              NOCREATEROLE NOBYPASSRLS;
          END IF;
        END $$;
    """)
    # Prevent the data API role from reading credentials introduced in phase 3.
    op.execute("REVOKE SELECT ON users FROM bodyvision_app")
    op.execute(
        "GRANT SELECT(id,organization_id,display_name,is_local_operator,"
        "account_status) ON users TO bodyvision_app"
    )
    op.execute("GRANT USAGE ON SCHEMA public TO bodyvision_auth_app")
    op.execute(
        "GRANT SELECT(id,organization_id,email,password_hash,account_status,"
        "is_local_operator,display_name) ON users TO bodyvision_auth_app"
    )
    op.execute(
        "GRANT SELECT(organization_id,user_id,role,expires_at) "
        "ON user_role_assignments TO bodyvision_auth_app"
    )
    op.execute(
        "GRANT INSERT(id,organization_id,user_id,token_sha256,expires_at) "
        "ON auth_sessions TO bodyvision_auth_app"
    )
    op.execute("""
        CREATE POLICY auth_session_issue ON auth_sessions
          FOR INSERT TO bodyvision_auth_app WITH CHECK (
            organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
            AND user_id=NULLIF(current_setting('app.actor_id',true),'')::uuid
            AND EXISTS (
              SELECT 1 FROM users u WHERE u.id=auth_sessions.user_id
                AND u.organization_id=auth_sessions.organization_id
                AND u.account_status='active' AND NOT u.is_local_operator
            )
          );
    """)
    # Resolution depends solely on a random 256-bit opaque token's digest,
    # not on any user-supplied organization or actor header.
    op.execute("""
        CREATE FUNCTION resolve_authenticated_session(token_digest char(64))
        RETURNS TABLE(org_id uuid,actor_id uuid,assigned_role text)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
          SELECT s.organization_id,s.user_id,role_assignment.role::text
          FROM auth_sessions s
          JOIN users u ON u.id=s.user_id AND u.organization_id=s.organization_id
          JOIN LATERAL (
            SELECT r.role FROM user_role_assignments r
            WHERE r.organization_id=s.organization_id AND r.user_id=s.user_id
              AND (r.expires_at IS NULL OR r.expires_at>now())
            ORDER BY CASE r.role
              WHEN 'administrator' THEN 1
              WHEN 'specialist' THEN 2 ELSE 3 END
            LIMIT 1
          ) role_assignment ON true
          WHERE s.token_sha256=token_digest AND s.revoked_at IS NULL
            AND s.expires_at>now() AND u.account_status='active'
            AND u.password_hash IS NOT NULL AND u.email IS NOT NULL
            AND NOT u.is_local_operator
          LIMIT 1
        $$;
        REVOKE ALL ON FUNCTION resolve_authenticated_session(char(64)) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION resolve_authenticated_session(char(64))
          TO bodyvision_auth_app;
    """)
    op.execute("""
        CREATE FUNCTION revoke_authenticated_session(token_digest char(64))
        RETURNS boolean
        LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public AS $$
        DECLARE updated_count integer;
        BEGIN
          UPDATE auth_sessions SET revoked_at=now()
          WHERE token_sha256=token_digest AND revoked_at IS NULL
            AND expires_at>now();
          GET DIAGNOSTICS updated_count=ROW_COUNT;
          RETURN updated_count>0;
        END $$;
        REVOKE ALL ON FUNCTION revoke_authenticated_session(char(64)) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION revoke_authenticated_session(char(64))
          TO bodyvision_auth_app;
    """)
    op.execute("UPDATE system_schema_state SET revision='0004_private_auth'")


def downgrade() -> None:
    op.execute(
        "REVOKE ALL ON FUNCTION resolve_authenticated_session(char(64)) FROM bodyvision_auth_app"
    )
    op.execute(
        "REVOKE ALL ON FUNCTION revoke_authenticated_session(char(64)) FROM bodyvision_auth_app"
    )
    op.execute("REVOKE SELECT ON users FROM bodyvision_app")
    op.execute("GRANT SELECT ON users TO bodyvision_app")
    op.execute("DROP FUNCTION revoke_authenticated_session(char(64))")
    op.execute("DROP FUNCTION resolve_authenticated_session(char(64))")
    op.execute("DROP POLICY auth_session_issue ON auth_sessions")
    op.execute("REVOKE ALL ON auth_sessions,user_role_assignments,users FROM bodyvision_auth_app")
    op.execute("UPDATE system_schema_state SET revision='0003_identity_foundation'")
