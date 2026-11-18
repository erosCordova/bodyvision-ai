"""Phase 3 security schema: inactive identities, sessions, roles, consent and audit.

The public synthetic demo stays read-only and does not grant access to these
tables. Phase 3 endpoints will be enabled only after authentication, RBAC,
consent checks, and cross-tenant security tests have been completed.
"""

from alembic import op

revision = "0003_identity_foundation"
down_revision = "0002_data_core"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE users
          ADD COLUMN email varchar(254),
          ADD COLUMN password_hash varchar(256),
          ADD COLUMN account_status varchar(12) NOT NULL DEFAULT 'disabled'
            CHECK (account_status IN ('active','disabled','locked'));
        CREATE UNIQUE INDEX user_email_per_organization
          ON users(organization_id,lower(email)) WHERE email IS NOT NULL;
        CREATE TABLE user_role_assignments (
          id uuid PRIMARY KEY,
          organization_id uuid NOT NULL,
          user_id uuid NOT NULL,
          role varchar(20) NOT NULL CHECK(role IN ('administrator','specialist','member')),
          granted_at timestamptz NOT NULL DEFAULT now(),
          granted_by uuid,
          expires_at timestamptz,
          UNIQUE (organization_id,user_id,role),
          FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id),
          FOREIGN KEY(organization_id,granted_by) REFERENCES users(organization_id,id),
          CHECK (expires_at IS NULL OR expires_at>granted_at)
        );
        CREATE TABLE auth_sessions (
          id uuid PRIMARY KEY,
          organization_id uuid NOT NULL,
          user_id uuid NOT NULL,
          token_sha256 char(64) NOT NULL UNIQUE
            CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
          issued_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL,
          revoked_at timestamptz,
          FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id),
          CHECK (expires_at>issued_at),
          CHECK (revoked_at IS NULL OR revoked_at>=issued_at)
        );
        CREATE INDEX auth_sessions_user_expiry
          ON auth_sessions(organization_id,user_id,expires_at);
        CREATE TABLE profile_consents (
          id uuid PRIMARY KEY,
          organization_id uuid NOT NULL,
          profile_id uuid NOT NULL,
          purpose varchar(20) NOT NULL CHECK(purpose IN ('capture','pose','report','storage')),
          version varchar(32) NOT NULL,
          status varchar(10) NOT NULL CHECK(status IN ('pending','accepted','revoked')),
          accepted_at timestamptz,
          revoked_at timestamptz,
          expires_at timestamptz,
          recorded_by uuid NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          FOREIGN KEY(organization_id,profile_id) REFERENCES profiles(organization_id,id),
          FOREIGN KEY(organization_id,recorded_by) REFERENCES users(organization_id,id),
          CHECK (
            (status='pending' AND accepted_at IS NULL AND revoked_at IS NULL)
            OR (status='accepted' AND accepted_at IS NOT NULL AND revoked_at IS NULL)
            OR (status='revoked' AND accepted_at IS NOT NULL AND revoked_at IS NOT NULL)
          ),
          CHECK (expires_at IS NULL OR accepted_at IS NULL OR expires_at>accepted_at),
          CHECK (revoked_at IS NULL OR revoked_at>=accepted_at),
          UNIQUE(organization_id,profile_id,purpose,version)
        );
        CREATE INDEX profile_consents_lookup
          ON profile_consents(organization_id,profile_id,purpose,status);
        CREATE TABLE security_audit_events (
          id uuid PRIMARY KEY,
          organization_id uuid NOT NULL,
          actor_id uuid,
          correlation_id uuid NOT NULL,
          action varchar(100) NOT NULL,
          resource_type varchar(60) NOT NULL,
          resource_id uuid,
          outcome varchar(10) NOT NULL CHECK(outcome IN ('allowed','denied','error')),
          happened_at timestamptz NOT NULL DEFAULT now(),
          FOREIGN KEY(organization_id) REFERENCES organizations(id),
          FOREIGN KEY(organization_id,actor_id) REFERENCES users(organization_id,id)
        );
        CREATE INDEX security_audit_org_time
          ON security_audit_events(organization_id,happened_at DESC);
    """)

    # Least-privilege default: the untrusted local/demo application role has
    # NO privileges on identity, session, consent, or audit tables.
    for table in (
        "user_role_assignments",
        "auth_sessions",
        "profile_consents",
        "security_audit_events",
    ):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"REVOKE ALL ON TABLE {table} FROM PUBLIC,bodyvision_app")

    # Explicit tenant + actor RLS policies for the future authenticated worker.
    # These are not a substitute for a dedicated, properly scoped DB role.
    op.execute("""
        CREATE POLICY roles_tenant_actor ON user_role_assignments
        USING (
          organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
          AND user_id=NULLIF(current_setting('app.actor_id',true),'')::uuid
        );
        CREATE POLICY sessions_tenant_actor ON auth_sessions
        USING (
          organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
          AND user_id=NULLIF(current_setting('app.actor_id',true),'')::uuid
        );
        CREATE POLICY consent_tenant_actor ON profile_consents
        USING (
          organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
          AND has_profile_access(profile_id)
        );
        CREATE POLICY audit_tenant_actor ON security_audit_events
        USING (
          organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
          AND actor_id=NULLIF(current_setting('app.actor_id',true),'')::uuid
        );
    """)
    op.execute("UPDATE system_schema_state SET revision='0003_identity_foundation'")


def downgrade() -> None:
    for table in (
        "security_audit_events",
        "profile_consents",
        "auth_sessions",
        "user_role_assignments",
    ):
        op.execute(f"DROP TABLE {table}")
    op.execute("DROP INDEX user_email_per_organization")
    op.execute(
        "ALTER TABLE users DROP COLUMN account_status,DROP COLUMN password_hash,DROP COLUMN email"
    )
    op.execute("UPDATE system_schema_state SET revision='0002_data_core'")
