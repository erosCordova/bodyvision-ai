"""Argon2id admission for new passwords and atomic authenticated legacy upgrade."""

from sqlalchemy import text

from alembic import op

revision = "0023_argon2_passwords"
down_revision = "0022_report_format_audit"
branch_labels = None
depends_on = None

LEGACY = "^pbkdf2_sha256[$]600000[$][0-9a-f]{32}[$][0-9a-f]{64}$"
CURRENT = "^[$]argon2id[$]v=19[$]m=65536,t=3,p=4[$][A-Za-z0-9+/]{22}[$][A-Za-z0-9+/]{43}$"
WRITERS = (
    "public.provision_synthetic_user(character,uuid,uuid,text,text,text,text,uuid,uuid)",
    "public.reset_synthetic_password(character,uuid,text,text,uuid,uuid)",
    "public.private_own_security_change(character,text,uuid,text,text,uuid,uuid)",
)


def replace_admission(previous: str, current: str) -> None:
    # Replace exactly one admission predicate in each CURRENT function body;
    # preserve all its permission, locking, session and audit logic and grants.
    for signature in WRITERS:
        definition = (
            op.get_bind()
            .execute(
                text("SELECT pg_get_functiondef(CAST(:signature AS regprocedure))"),
                {"signature": signature},
            )
            .scalar_one()
        )
        if definition.count(previous) != 1:
            raise RuntimeError("Unexpected password writer definition; migration refused")
        op.execute(definition.replace(previous, current))


def upgrade() -> None:
    replace_admission(LEGACY, CURRENT)
    op.execute("""
        CREATE FUNCTION public.upgrade_private_password_verifier(
          digest char(64), expected_verifier text, new_verifier text,
          event_identifier uuid, correlation uuid
        ) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE tenant uuid; actor uuid; stored text;
        BEGIN
          IF new_verifier IS NULL OR new_verifier !~
            '^[$]argon2id[$]v=19[$]m=65536,t=3,p=4[$][A-Za-z0-9+/]{22}[$][A-Za-z0-9+/]{43}$'
            OR expected_verifier IS NULL OR event_identifier IS NULL OR correlation IS NULL
            THEN RETURN false; END IF;
          SELECT r.org_id,r.actor_id INTO tenant,actor
            FROM public.resolve_authenticated_session(digest) r;
          IF tenant IS NULL THEN RETURN false; END IF;
          SELECT u.password_hash INTO stored FROM public.users u
            JOIN public.organizations o ON o.id=u.organization_id
            WHERE u.organization_id=tenant AND u.id=actor AND o.synthetic
              AND u.account_status='active' AND NOT u.is_local_operator
              AND split_part(u.email,'@',2)='example.invalid'
            FOR UPDATE OF u;
          IF stored IS NULL OR stored<>expected_verifier OR NOT EXISTS(
            SELECT 1 FROM public.resolve_authenticated_session(digest)
          ) THEN RETURN false; END IF;
          UPDATE public.users SET password_hash=new_verifier
            WHERE organization_id=tenant AND id=actor;
          INSERT INTO public.security_audit_events(
            id,organization_id,actor_id,correlation_id,action,resource_type,resource_id,outcome
          ) VALUES(event_identifier,tenant,actor,correlation,
            'auth.password_rehashed','user',actor,'allowed');
          RETURN true;
        END $$;
        REVOKE ALL ON FUNCTION upgrade_private_password_verifier(char(64),text,text,uuid,uuid)
          FROM PUBLIC,bodyvision_app;
        GRANT EXECUTE ON FUNCTION upgrade_private_password_verifier(char(64),text,text,uuid,uuid)
          TO bodyvision_auth_app;
        UPDATE system_schema_state SET revision='0023_argon2_passwords';
    """)


def downgrade() -> None:
    op.execute("DROP FUNCTION upgrade_private_password_verifier(char(64),text,text,uuid,uuid)")
    replace_admission(CURRENT, LEGACY)
    op.execute("UPDATE system_schema_state SET revision='0022_report_format_audit'")
