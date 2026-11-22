"""Session-family lineage and refresh-token reuse detection.

Every login opens one family. Rotations keep the family identifier and record
the consumed parent, so replaying a refresh token that was already exchanged
can revoke the whole family instead of merely answering 401. Only rotation
consumes a token: logout, password change and administrative revocation still
set ``revoked_at`` alone, so replaying a deliberately closed session never
masquerades as credential theft.

A short grace window covers legitimate concurrent refreshes (two tabs racing
on the same cookie). The replay of a consumed token inside that window gets a
plain 401 without issuing credentials, so it grants an attacker nothing, while
a later replay invalidates the family and is audited.
"""

from alembic import op

revision = "0026_refresh_session_families"
down_revision = "0025_synthetic_invitations"
branch_labels = None
depends_on = None

# Concurrent rotations of one cookie are serialized by the existing user lock.
# The loser observes the token as consumed milliseconds later; this window
# keeps that legitimate race from being treated as theft.
REUSE_GRACE = "10 seconds"

_ISSUE_SESSION_WITH_FAMILY = """
        CREATE OR REPLACE FUNCTION public.issue_private_session(
          tenant uuid, actor uuid, expected_verifier text,
          session_identifier uuid, session_digest char(64)
        ) RETURNS jsonb
        LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE stored_verifier text; resolved_user_role text; expiration timestamptz;
        BEGIN
          SELECT u.password_hash INTO stored_verifier
          FROM public.users u JOIN public.organizations o ON o.id=u.organization_id
          WHERE u.id=actor AND u.organization_id=tenant AND o.synthetic
            AND u.account_status='active' AND NOT u.is_local_operator
            AND split_part(u.email,'@',2)='example.invalid'
          FOR UPDATE OF u;
          IF NOT FOUND OR stored_verifier IS NULL OR expected_verifier IS NULL
            OR stored_verifier<>expected_verifier THEN RETURN NULL; END IF;
          SELECT r.role INTO resolved_user_role FROM public.user_role_assignments r
          WHERE r.organization_id=tenant AND r.user_id=actor
            AND (r.expires_at IS NULL OR r.expires_at>now())
          ORDER BY CASE r.role WHEN 'administrator' THEN 1
            WHEN 'specialist' THEN 2 ELSE 3 END LIMIT 1;
          IF resolved_user_role IS NULL THEN RETURN NULL; END IF;
          IF session_digest IS NULL OR session_digest !~ '^[0-9a-f]{64}$'
            THEN RAISE EXCEPTION 'Invalid session digest' USING ERRCODE='22023';
          END IF;
          expiration := now()+interval '8 hours';
          INSERT INTO public.auth_sessions(
            id,organization_id,user_id,token_sha256,expires_at,family_id
          ) VALUES(session_identifier,tenant,actor,session_digest,expiration,
            session_identifier);
          RETURN jsonb_build_object('expires_at',expiration,'role',resolved_user_role);
        END $$;
"""

# The 0010 body, restored by downgrade after family_id is dropped. Keeping it
# verbatim (without family_id) prevents a function that references a column
# that no longer exists.
_ISSUE_SESSION_BEFORE_0026 = """
        CREATE OR REPLACE FUNCTION public.issue_private_session(
          tenant uuid, actor uuid, expected_verifier text,
          session_identifier uuid, session_digest char(64)
        ) RETURNS jsonb
        LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE stored_verifier text; resolved_user_role text; expiration timestamptz;
        BEGIN
          SELECT u.password_hash INTO stored_verifier
          FROM public.users u JOIN public.organizations o ON o.id=u.organization_id
          WHERE u.id=actor AND u.organization_id=tenant AND o.synthetic
            AND u.account_status='active' AND NOT u.is_local_operator
            AND split_part(u.email,'@',2)='example.invalid'
          FOR UPDATE OF u;
          IF NOT FOUND OR stored_verifier IS NULL OR expected_verifier IS NULL
            OR stored_verifier<>expected_verifier THEN RETURN NULL; END IF;
          SELECT r.role INTO resolved_user_role FROM public.user_role_assignments r
          WHERE r.organization_id=tenant AND r.user_id=actor
            AND (r.expires_at IS NULL OR r.expires_at>now())
          ORDER BY CASE r.role WHEN 'administrator' THEN 1
            WHEN 'specialist' THEN 2 ELSE 3 END LIMIT 1;
          IF resolved_user_role IS NULL THEN RETURN NULL; END IF;
          IF session_digest IS NULL OR session_digest !~ '^[0-9a-f]{64}$'
            THEN RAISE EXCEPTION 'Invalid session digest' USING ERRCODE='22023';
          END IF;
          expiration := now()+interval '8 hours';
          INSERT INTO public.auth_sessions(id,organization_id,user_id,token_sha256,expires_at)
          VALUES(session_identifier,tenant,actor,session_digest,expiration);
          RETURN jsonb_build_object('expires_at',expiration,'role',resolved_user_role);
        END $$;
"""

_PREVIOUS_ROTATE_SESSION = """
        CREATE OR REPLACE FUNCTION public.private_rotate_session(
          previous_digest char(64), replacement_digest char(64),
          replacement_id uuid, event_identifier uuid, correlation uuid
        ) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE tenant uuid; actor uuid; locked_actor uuid;
          previous_id uuid; previous_expiration timestamptz; prior_mfa timestamptz;
          effective_role text;
        BEGIN
          IF previous_digest IS NULL OR replacement_digest IS NULL
            OR replacement_digest !~ '^[0-9a-f]{64}$'
            OR replacement_digest=previous_digest
            OR replacement_id IS NULL OR event_identifier IS NULL
            OR correlation IS NULL THEN
            RETURN jsonb_build_object('status','invalid');
          END IF;
          SELECT s.organization_id,s.user_id INTO tenant,actor
            FROM public.auth_sessions s WHERE s.token_sha256=previous_digest;
          IF tenant IS NULL THEN
            RETURN jsonb_build_object('status','unauthorized');
          END IF;
          SELECT u.id INTO locked_actor FROM public.users u
            JOIN public.organizations o ON o.id=u.organization_id
            WHERE u.id=actor AND u.organization_id=tenant AND o.synthetic
              AND u.account_status='active' AND NOT u.is_local_operator
              AND split_part(u.email,'@',2)='example.invalid'
            FOR UPDATE OF u;
          IF locked_actor IS NULL THEN
            RETURN jsonb_build_object('status','unauthorized');
          END IF;
          SELECT s.id,s.expires_at,s.mfa_verified_at
            INTO previous_id,previous_expiration,prior_mfa
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
"""


def upgrade() -> None:
    op.execute("""
        ALTER TABLE public.auth_sessions
          -- A session inserted outside the issuance function still opens its
          -- own family instead of failing the not-null constraint.
          ADD COLUMN family_id uuid DEFAULT gen_random_uuid(),
          ADD COLUMN parent_session_id uuid,
          ADD COLUMN consumed_at timestamptz;
        -- Historical sessions predate lineage: each one becomes its own family.
        UPDATE public.auth_sessions SET family_id=id;
        ALTER TABLE public.auth_sessions
          ALTER COLUMN family_id SET NOT NULL,
          ADD CONSTRAINT auth_sessions_family_parent
            FOREIGN KEY(parent_session_id) REFERENCES public.auth_sessions(id)
            ON DELETE SET NULL,
          ADD CONSTRAINT auth_sessions_consumed_revoked
            CHECK (consumed_at IS NULL OR
              (revoked_at IS NOT NULL AND consumed_at>=issued_at)),
          ADD CONSTRAINT auth_sessions_parent_not_self
            CHECK (parent_session_id IS NULL OR parent_session_id<>id);
        CREATE INDEX auth_sessions_family ON public.auth_sessions(family_id);
    """)
    op.execute(_ISSUE_SESSION_WITH_FAMILY)
    op.execute(f"""
        CREATE OR REPLACE FUNCTION public.private_rotate_session(
          previous_digest char(64), replacement_digest char(64),
          replacement_id uuid, event_identifier uuid, correlation uuid
        ) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE tenant uuid; actor uuid; locked_actor uuid;
          previous_id uuid; previous_family uuid; previous_expiration timestamptz;
          prior_mfa timestamptz; previous_revoked timestamptz;
          previous_consumed timestamptz; effective_role text;
        BEGIN
          IF previous_digest IS NULL OR replacement_digest IS NULL
            OR replacement_digest !~ '^[0-9a-f]{{64}}$'
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

          -- Read the exact row under lock. It may already be revoked because
          -- it was rotated, logged out, reset or revoked by the account owner.
          SELECT s.id,s.family_id,s.expires_at,s.mfa_verified_at,s.revoked_at,
            s.consumed_at
            INTO previous_id,previous_family,previous_expiration,prior_mfa,
              previous_revoked,previous_consumed
            FROM public.auth_sessions s
            WHERE s.token_sha256=previous_digest
              AND s.organization_id=tenant AND s.user_id=actor
            FOR UPDATE;
          IF previous_id IS NULL THEN
            RETURN jsonb_build_object('status','unauthorized');
          END IF;

          IF previous_revoked IS NOT NULL THEN
            -- Only a token consumed by rotation can be replayed. A token
            -- closed by logout/password/administrative revocation has no
            -- successor to protect, so replaying it is just unauthorized.
            IF previous_consumed IS NOT NULL
              AND previous_consumed <= clock_timestamp()-interval '{REUSE_GRACE}'
            THEN
              -- Credential theft assumed: terminate every live sibling in
              -- the family, including the current replacement.
              UPDATE public.auth_sessions SET revoked_at=clock_timestamp()
                WHERE family_id=previous_family
                  AND organization_id=tenant AND user_id=actor
                  AND revoked_at IS NULL;
              INSERT INTO public.security_audit_events(
                id,organization_id,actor_id,correlation_id,
                action,resource_type,resource_id,outcome
              ) VALUES(
                event_identifier,tenant,actor,correlation,
                'auth.refresh_reuse_detected','session_family',
                previous_family,'denied'
              );
              RETURN jsonb_build_object('status','reuse-detected');
            END IF;
            RETURN jsonb_build_object('status','unauthorized');
          END IF;

          IF previous_expiration<=clock_timestamp() THEN
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

          UPDATE public.auth_sessions
            SET revoked_at=clock_timestamp(),consumed_at=clock_timestamp()
            WHERE token_sha256=previous_digest;
          INSERT INTO public.auth_sessions(
            id,organization_id,user_id,token_sha256,expires_at,mfa_verified_at,
            family_id,parent_session_id
          ) VALUES(
            replacement_id,tenant,actor,replacement_digest,
            previous_expiration,prior_mfa,previous_family,previous_id
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
        UPDATE public.system_schema_state
          SET revision='0026_refresh_session_families';
    """)


def downgrade() -> None:
    op.execute(_ISSUE_SESSION_BEFORE_0026)
    op.execute(_PREVIOUS_ROTATE_SESSION)
    op.execute("DROP INDEX public.auth_sessions_family")
    op.execute("""
        ALTER TABLE public.auth_sessions
          DROP CONSTRAINT auth_sessions_parent_not_self,
          DROP CONSTRAINT auth_sessions_consumed_revoked,
          DROP CONSTRAINT auth_sessions_family_parent,
          DROP COLUMN consumed_at,
          DROP COLUMN parent_session_id,
          DROP COLUMN family_id;
    """)
    op.execute("UPDATE public.system_schema_state SET revision='0025_synthetic_invitations'")
