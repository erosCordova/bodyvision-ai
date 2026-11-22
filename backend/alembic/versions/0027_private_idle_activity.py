"""Authoritative 15-minute idle session boundary for local/test identity.

A refresh rotation inherits its parent's last human activity timestamp. Only
the authenticated activity endpoint updates this timestamp; automatic refresh
alone cannot keep an unattended session alive.
"""

import re

from sqlalchemy import text

from alembic import op

revision = "0027_private_idle_activity"
down_revision = "0026_refresh_session_families"
branch_labels = None
depends_on = None

EXPIRY = re.compile(r"\bs\.expires_at\s*>\s*now\(\)")
IDLE_EXPIRY = re.compile(
    r"\(s\.expires_at\s*>\s*now\(\)\s+AND\s+"
    r"s\.last_activity_at\s*>\s*now\(\)\s*-\s*"
    r"interval\s*'15 minutes'\)"
)


def _rewrite_resolver(with_idle: bool) -> None:
    definition = op.get_bind().execute(
        text(
            "SELECT pg_get_functiondef("
            "'public.resolve_authenticated_session(char(64))'::regprocedure)"
        )
    ).scalar_one()
    if with_idle:
        result, matches = EXPIRY.subn(
            "(s.expires_at > now() AND "
            "s.last_activity_at > now() - interval '15 minutes')",
            definition,
        )
    else:
        result, matches = IDLE_EXPIRY.subn("s.expires_at > now()", definition)
    if matches != 1:
        raise RuntimeError("Session resolver revision mismatch; refusing migration")
    op.execute(result)


def upgrade() -> None:
    op.execute("""
        ALTER TABLE public.auth_sessions ADD COLUMN last_activity_at timestamptz;
        -- Prior sessions have not supplied an authenticated human heartbeat.
        UPDATE public.auth_sessions SET last_activity_at=issued_at;
        ALTER TABLE public.auth_sessions
          ALTER COLUMN last_activity_at SET NOT NULL,
          ALTER COLUMN last_activity_at SET DEFAULT clock_timestamp();
        CREATE INDEX auth_sessions_user_activity
          ON public.auth_sessions(organization_id,user_id,last_activity_at);
    """)
    _rewrite_resolver(True)
    op.execute("""
        CREATE FUNCTION public.inherit_private_session_activity()
        RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE parent_activity timestamptz;
        BEGIN
          IF NEW.parent_session_id IS NOT NULL THEN
            SELECT s.last_activity_at INTO parent_activity
              FROM public.auth_sessions s
              WHERE s.id=NEW.parent_session_id
                AND s.organization_id=NEW.organization_id
                AND s.user_id=NEW.user_id
                AND s.family_id=NEW.family_id;
            IF NOT FOUND THEN
              RAISE EXCEPTION 'Invalid session rotation parent'
                USING ERRCODE='42501';
            END IF;
            NEW.last_activity_at := parent_activity;
          END IF;
          RETURN NEW;
        END $$;
        REVOKE ALL ON FUNCTION public.inherit_private_session_activity()
          FROM PUBLIC,bodyvision_app,bodyvision_auth_app;
        CREATE TRIGGER auth_sessions_inherit_activity
          BEFORE INSERT ON public.auth_sessions FOR EACH ROW
          EXECUTE FUNCTION public.inherit_private_session_activity();
    """)
    op.execute("""
        CREATE FUNCTION public.private_confirm_session_activity(session_digest char(64))
        RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE updated boolean := false;
        BEGIN
          IF session_digest IS NULL OR session_digest !~ '^[0-9a-f]{64}$'
          THEN RETURN false; END IF;
          -- The exact session must remain live under the resolver's current
          -- account, role, consent-independent session and idle rules.
          UPDATE public.auth_sessions s
            SET last_activity_at=clock_timestamp()
            WHERE s.token_sha256=session_digest
              AND s.revoked_at IS NULL
              AND s.expires_at>clock_timestamp()
              AND s.last_activity_at>clock_timestamp()-interval '15 minutes'
              AND EXISTS(
                SELECT 1 FROM public.resolve_authenticated_session(session_digest)
              )
            RETURNING true INTO updated;
          RETURN COALESCE(updated,false);
        END $$;
        REVOKE ALL ON FUNCTION public.private_confirm_session_activity(char(64))
          FROM PUBLIC,bodyvision_app;
        GRANT EXECUTE ON FUNCTION public.private_confirm_session_activity(char(64))
          TO bodyvision_auth_app;
        UPDATE public.system_schema_state
          SET revision='0027_private_idle_activity';
    """)


def downgrade() -> None:
    op.execute("DROP FUNCTION public.private_confirm_session_activity(char(64))")
    op.execute("DROP TRIGGER auth_sessions_inherit_activity ON public.auth_sessions")
    op.execute("DROP FUNCTION public.inherit_private_session_activity()")
    _rewrite_resolver(False)
    op.execute("DROP INDEX public.auth_sessions_user_activity")
    op.execute("ALTER TABLE public.auth_sessions DROP COLUMN last_activity_at")
    op.execute("UPDATE public.system_schema_state SET revision='0026_refresh_session_families'")
