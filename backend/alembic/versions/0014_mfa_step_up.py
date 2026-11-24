"""Privileged MFA step-up and atomic TOTP/recovery transitions (synthetic CI only)."""

from alembic import op

revision = "0014_mfa_step_up"
down_revision = "0013_mfa_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE public.auth_sessions ADD COLUMN mfa_verified_at timestamptz;

        CREATE FUNCTION public.private_mfa_snapshot(
          tenant uuid, actor uuid, expected_verifier text
        ) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE c record; codes jsonb;
        BEGIN
          IF NOT EXISTS(
            SELECT 1 FROM public.users u JOIN public.organizations o
              ON o.id=u.organization_id
            WHERE u.id=actor AND u.organization_id=tenant AND o.synthetic
              AND u.account_status='active' AND NOT u.is_local_operator
              AND split_part(u.email,'@',2)='example.invalid'
              AND u.password_hash=expected_verifier
              AND EXISTS(
                SELECT 1 FROM public.user_role_assignments r
                WHERE r.organization_id=tenant AND r.user_id=actor
                  AND r.role IN ('administrator','specialist')
                  AND (r.expires_at IS NULL OR r.expires_at>now()))
          ) THEN RETURN jsonb_build_object('status','denied'); END IF;
          SELECT encrypted_totp_seed,confirmed_at,last_accepted_step INTO c
          FROM public.private_mfa_credentials
          WHERE organization_id=tenant AND user_id=actor;
          IF NOT FOUND THEN RETURN jsonb_build_object('status','not-enrolled'); END IF;
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id',id,'verifier',code_verifier) ORDER BY id),'[]'::jsonb)
          INTO codes FROM public.private_mfa_recovery_codes
          WHERE organization_id=tenant AND user_id=actor AND consumed_at IS NULL;
          RETURN jsonb_build_object('status',
            CASE WHEN c.confirmed_at IS NULL THEN 'pending' ELSE 'enrolled' END,
            'ciphertext',c.encrypted_totp_seed,
            'last_step',c.last_accepted_step,'recovery',codes);
        END $$;

        CREATE FUNCTION public.private_mfa_transition(
          tenant uuid, actor uuid, expected_verifier text, operation text,
          ciphertext text, step bigint, recovery_id uuid, recovery_verifier text,
          recovery_codes jsonb, event_identifier uuid, correlation uuid
        ) RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE stored text; c record; changed integer := 0; event_action text;
        BEGIN
          SELECT u.password_hash INTO stored FROM public.users u
            JOIN public.organizations o ON o.id=u.organization_id
          WHERE u.id=actor AND u.organization_id=tenant AND o.synthetic
            AND u.account_status='active' AND NOT u.is_local_operator
            AND split_part(u.email,'@',2)='example.invalid'
            AND EXISTS(SELECT 1 FROM public.user_role_assignments r
              WHERE r.organization_id=tenant AND r.user_id=actor
                AND r.role IN ('administrator','specialist')
                AND (r.expires_at IS NULL OR r.expires_at>now()))
          FOR UPDATE OF u;
          IF stored IS NULL OR expected_verifier IS NULL OR stored<>expected_verifier
            THEN RETURN 'denied'; END IF;
          IF operation='begin' THEN
            IF ciphertext IS NULL OR length(ciphertext) NOT BETWEEN 80 AND 512
              THEN RETURN 'denied'; END IF;
            INSERT INTO public.private_mfa_credentials
              (organization_id,user_id,encrypted_totp_seed)
            VALUES (tenant,actor,ciphertext)
            ON CONFLICT(organization_id,user_id) DO UPDATE
              SET encrypted_totp_seed=excluded.encrypted_totp_seed,
                  enrolled_at=now(),last_accepted_step=-1
              WHERE public.private_mfa_credentials.confirmed_at IS NULL;
            GET DIAGNOSTICS changed=ROW_COUNT;
            IF changed<>1 THEN RETURN 'denied'; END IF;
            DELETE FROM public.private_mfa_recovery_codes
              WHERE organization_id=tenant AND user_id=actor;
            event_action := 'mfa.enrollment_started';
          ELSE
            SELECT encrypted_totp_seed,confirmed_at,last_accepted_step INTO c
              FROM public.private_mfa_credentials
              WHERE organization_id=tenant AND user_id=actor FOR UPDATE;
            IF NOT FOUND THEN RETURN 'denied'; END IF;
            IF operation='confirm' THEN
              IF c.confirmed_at IS NOT NULL OR ciphertext IS NULL
                OR c.encrypted_totp_seed<>ciphertext OR step IS NULL
                OR step<=c.last_accepted_step OR recovery_codes IS NULL
                OR jsonb_typeof(recovery_codes)<>'array'
                OR jsonb_array_length(recovery_codes)<>8
                THEN RETURN 'denied'; END IF;
              IF EXISTS(SELECT 1 FROM jsonb_array_elements(recovery_codes) e
                WHERE e->>'verifier' !~
                  '^pbkdf2_sha256[$]600000[$][0-9a-f]{32}[$][0-9a-f]{64}$'
                  OR (e->>'id') IS NULL
                  OR (e->>'id') !~
                    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
                THEN RETURN 'denied'; END IF;
              UPDATE public.private_mfa_credentials
                SET confirmed_at=clock_timestamp(),last_accepted_step=step
                WHERE organization_id=tenant AND user_id=actor;
              INSERT INTO public.private_mfa_recovery_codes
                (id,organization_id,user_id,code_verifier)
                SELECT (e->>'id')::uuid,tenant,actor,e->>'verifier'
                FROM jsonb_array_elements(recovery_codes) e;
              event_action := 'mfa.enrollment_confirmed';
            ELSIF operation='totp' THEN
              IF c.confirmed_at IS NULL OR ciphertext IS NULL
                OR c.encrypted_totp_seed<>ciphertext OR step IS NULL
                OR step<=c.last_accepted_step THEN RETURN 'denied'; END IF;
              UPDATE public.private_mfa_credentials SET last_accepted_step=step
                WHERE organization_id=tenant AND user_id=actor;
              event_action := 'mfa.totp_accepted';
            ELSIF operation='recovery' THEN
              IF c.confirmed_at IS NULL OR recovery_id IS NULL
                OR recovery_verifier IS NULL THEN RETURN 'denied'; END IF;
              UPDATE public.private_mfa_recovery_codes SET consumed_at=clock_timestamp()
                WHERE id=recovery_id AND organization_id=tenant AND user_id=actor
                  AND code_verifier=recovery_verifier AND consumed_at IS NULL;
              GET DIAGNOSTICS changed=ROW_COUNT;
              IF changed<>1 THEN RETURN 'denied'; END IF;
              event_action := 'mfa.recovery_consumed';
            ELSE RETURN 'denied';
            END IF;
          END IF;
          INSERT INTO public.security_audit_events
            (id,organization_id,actor_id,correlation_id,action,resource_type,resource_id,outcome)
          VALUES (event_identifier,tenant,actor,correlation,
            event_action,'user',actor,'allowed');
          RETURN 'ok';
        END $$;

        CREATE FUNCTION public.private_mfa_mark_session(
          tenant uuid, actor uuid, expected_verifier text, session_digest char(64)
        ) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE updated integer;
        BEGIN
          UPDATE public.auth_sessions s SET mfa_verified_at=clock_timestamp()
          WHERE s.organization_id=tenant AND s.user_id=actor
            AND s.token_sha256=session_digest AND s.revoked_at IS NULL
            AND s.expires_at>now()
            AND EXISTS(SELECT 1 FROM public.private_mfa_credentials c
              WHERE c.organization_id=tenant AND c.user_id=actor
                AND c.confirmed_at IS NOT NULL)
            AND EXISTS(SELECT 1 FROM public.users u
              WHERE u.organization_id=tenant AND u.id=actor
                AND u.password_hash=expected_verifier AND u.account_status='active');
          GET DIAGNOSTICS updated=ROW_COUNT;
          RETURN updated=1;
        END $$;

        CREATE FUNCTION public.private_mfa_session_verified(session_digest char(64))
        RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
          SELECT EXISTS(SELECT 1 FROM public.auth_sessions s
            WHERE s.token_sha256=session_digest AND s.mfa_verified_at IS NOT NULL
              AND s.revoked_at IS NULL AND s.expires_at>now())
        $$;
    """)
    for signature in (
        "private_mfa_snapshot(uuid,uuid,text)",
        "private_mfa_transition(uuid,uuid,text,text,text,bigint,uuid,text,jsonb,uuid,uuid)",
        "private_mfa_mark_session(uuid,uuid,text,char(64))",
        "private_mfa_session_verified(char(64))",
    ):
        op.execute(f"REVOKE ALL ON FUNCTION public.{signature} FROM PUBLIC,bodyvision_app")
        op.execute(f"GRANT EXECUTE ON FUNCTION public.{signature} TO bodyvision_auth_app")
    op.execute("UPDATE system_schema_state SET revision='0014_mfa_step_up'")


def downgrade() -> None:
    for signature in (
        "private_mfa_snapshot(uuid,uuid,text)",
        "private_mfa_transition(uuid,uuid,text,text,text,bigint,uuid,text,jsonb,uuid,uuid)",
        "private_mfa_mark_session(uuid,uuid,text,char(64))",
        "private_mfa_session_verified(char(64))",
    ):
        op.execute(f"DROP FUNCTION public.{signature}")
    op.execute("ALTER TABLE public.auth_sessions DROP COLUMN mfa_verified_at")
    op.execute("UPDATE system_schema_state SET revision='0013_mfa_foundation'")
