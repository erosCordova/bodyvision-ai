"""Atomic bearer-token rotation for synthetic local/test sessions.

This rotates the secret of one existing session without extending its original
eight-hour expiry. It is not the JWT/refresh-cookie architecture of ADR 0002.
"""

from alembic import op

revision = "0024_atomic_session_rotation"
down_revision = "0023_argon2_passwords"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE FUNCTION public.private_rotate_session(
          previous_digest char(64), replacement_digest char(64),
          replacement_id uuid, event_identifier uuid, correlation uuid
        ) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE tenant uuid; actor uuid; locked_actor uuid;
          previous_expiration timestamptz; prior_mfa timestamptz;
          effective_role text;
        BEGIN
          IF previous_digest IS NULL OR replacement_digest IS NULL
            OR replacement_digest !~ '^[0-9a-f]{64}$'
            OR replacement_digest=previous_digest
            OR replacement_id IS NULL OR event_identifier IS NULL
            OR correlation IS NULL THEN
            RETURN jsonb_build_object('status','invalid');
          END IF;

          -- Only identify a potential owner from the token digest. An
          -- unverified bearer does not grant access to any other tenant.
          SELECT s.organization_id,s.user_id INTO tenant,actor
            FROM public.auth_sessions s WHERE s.token_sha256=previous_digest;
          IF tenant IS NULL THEN
            RETURN jsonb_build_object('status','unauthorized');
          END IF;

          -- Preserve the user -> session lock order of password change/reset.
          -- This prevents refresh racing with credential revocation.
          SELECT u.id INTO locked_actor FROM public.users u
            JOIN public.organizations o ON o.id=u.organization_id
            WHERE u.id=actor AND u.organization_id=tenant AND o.synthetic
              AND u.account_status='active' AND NOT u.is_local_operator
              AND split_part(u.email,'@',2)='example.invalid'
            FOR UPDATE OF u;
          IF locked_actor IS NULL THEN
            RETURN jsonb_build_object('status','unauthorized');
          END IF;

          -- Under lock, only one racing request can consume this session.
          SELECT s.expires_at,s.mfa_verified_at
            INTO previous_expiration,prior_mfa
            FROM public.auth_sessions s
            WHERE s.token_sha256=previous_digest
              AND s.organization_id=tenant AND s.user_id=actor
              AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
            FOR UPDATE;
          IF NOT FOUND THEN
            RETURN jsonb_build_object('status','unauthorized');
          END IF;

          SELECT r.assigned_role INTO effective_role
            FROM public.resolve_authenticated_session(previous_digest) r;
          IF effective_role IS NULL THEN
            RETURN jsonb_build_object('status','unauthorized');
          END IF;
          -- Never extend the maximum lifetime, including close to expiry.
          IF previous_expiration <= clock_timestamp()+interval '30 seconds' THEN
            RETURN jsonb_build_object('status','relogin-required');
          END IF;

          UPDATE public.auth_sessions SET revoked_at=clock_timestamp()
            WHERE token_sha256=previous_digest;
          INSERT INTO public.auth_sessions(
            id,organization_id,user_id,token_sha256,expires_at,mfa_verified_at
          ) VALUES(
            replacement_id,tenant,actor,replacement_digest,
            previous_expiration,prior_mfa
          );
          INSERT INTO public.security_audit_events(
            id,organization_id,actor_id,correlation_id,
            action,resource_type,resource_id,outcome
          ) VALUES(
            event_identifier,tenant,actor,correlation,
            'auth.session_rotated','session',replacement_id,'allowed'
          );
          RETURN jsonb_build_object(
            'status','rotated','expires_at',previous_expiration,
            'organization_id',tenant,'user_id',actor,'role',effective_role
          );
        END $$;
        REVOKE ALL ON FUNCTION public.private_rotate_session(
          char(64),char(64),uuid,uuid,uuid
        ) FROM PUBLIC,bodyvision_app;
        GRANT EXECUTE ON FUNCTION public.private_rotate_session(
          char(64),char(64),uuid,uuid,uuid
        ) TO bodyvision_auth_app;
        UPDATE system_schema_state SET revision='0024_atomic_session_rotation';
    """)


def downgrade() -> None:
    op.execute(
        "DROP FUNCTION public.private_rotate_session(char(64),char(64),uuid,uuid,uuid)"
    )
    op.execute("UPDATE system_schema_state SET revision='0023_argon2_passwords'")
