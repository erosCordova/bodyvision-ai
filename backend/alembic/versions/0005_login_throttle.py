"""Transactional, account-scoped login throttling for private test sessions.

These counters live in PostgreSQL, not worker memory; concurrent requests and
separate backend instances share the same attempts. Email is never persisted.
"""

from alembic import op

revision = "0005_login_throttle"
down_revision = "0004_private_auth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE auth_login_attempts (
          organization_id uuid NOT NULL,
          email_sha256 char(64) NOT NULL
            CHECK (email_sha256 ~ '^[0-9a-f]{64}$'),
          attempt_count integer NOT NULL CHECK (attempt_count BETWEEN 1 AND 1000000),
          window_started timestamptz NOT NULL,
          blocked_until timestamptz,
          PRIMARY KEY (organization_id,email_sha256)
        );
        ALTER TABLE auth_login_attempts ENABLE ROW LEVEL SECURITY;
        REVOKE ALL ON auth_login_attempts FROM PUBLIC,bodyvision_app,bodyvision_auth_app;
    """)

    # The SECURITY DEFINER function is the only mutation surface. The auth
    # account has EXECUTE but cannot inspect or change the underlying table.
    # A single upsert atomically counts attempts across all server instances.
    op.execute("""
        CREATE FUNCTION consume_auth_login_attempt(
            org uuid, email_digest char(64)
        ) RETURNS boolean
        LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public AS $$
        DECLARE
          accepted boolean;
        BEGIN
          INSERT INTO auth_login_attempts AS previous
            (organization_id,email_sha256,attempt_count,window_started,blocked_until)
          VALUES (org,email_digest,1,now(),NULL)
          ON CONFLICT (organization_id,email_sha256) DO UPDATE SET
            attempt_count = CASE
              WHEN previous.blocked_until > now()
                THEN LEAST(previous.attempt_count+1,1000000)
              WHEN previous.window_started <= now()-interval '15 minutes'
                THEN 1
              ELSE LEAST(previous.attempt_count+1,1000000)
            END,
            window_started = CASE
              WHEN previous.blocked_until > now()
                THEN previous.window_started
              WHEN previous.window_started <= now()-interval '15 minutes'
                THEN now()
              ELSE previous.window_started
            END,
            blocked_until = CASE
              WHEN previous.blocked_until > now()
                THEN previous.blocked_until
              WHEN previous.window_started <= now()-interval '15 minutes'
                THEN NULL
              WHEN previous.attempt_count >= 5
                THEN now()+interval '15 minutes'
              ELSE NULL
            END
          RETURNING (
            attempt_count <= 5
            AND (blocked_until IS NULL OR blocked_until <= now())
          ) INTO accepted;
          RETURN accepted;
        END $$;
        REVOKE ALL ON FUNCTION consume_auth_login_attempt(uuid,char(64)) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION consume_auth_login_attempt(uuid,char(64))
          TO bodyvision_auth_app;
    """)

    op.execute("""
        CREATE FUNCTION clear_auth_login_attempts(
            org uuid, email_digest char(64)
        ) RETURNS void
        LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public AS $$
        BEGIN
          DELETE FROM auth_login_attempts
          WHERE organization_id=org AND email_sha256=email_digest;
        END $$;
        REVOKE ALL ON FUNCTION clear_auth_login_attempts(uuid,char(64)) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION clear_auth_login_attempts(uuid,char(64))
          TO bodyvision_auth_app;
    """)
    op.execute("UPDATE system_schema_state SET revision='0005_login_throttle'")


def downgrade() -> None:
    op.execute("DROP FUNCTION clear_auth_login_attempts(uuid,char(64))")
    op.execute("DROP FUNCTION consume_auth_login_attempt(uuid,char(64))")
    op.execute("DROP TABLE auth_login_attempts")
    op.execute("UPDATE system_schema_state SET revision='0004_private_auth'")
