"""Audited synthetic credential reset with serialized session issuance."""

from alembic import op

revision = "0010_admin_password_reset"
down_revision = "0009_private_consents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Temporary relations must not shadow the trusted tables used by the
    # existing helpers on which the new credential lifecycle depends.
    for signature in (
        "resolve_authenticated_session(char(64))",
        "record_authenticated_security_event(char(64),uuid,uuid,text,text)",
        "consume_auth_login_attempt(uuid,char(64))",
        "clear_auth_login_attempts(uuid,char(64))",
        "revoke_authenticated_session(char(64))",
    ):
        op.execute(f"ALTER FUNCTION public.{signature} SET search_path=pg_catalog,public,pg_temp")
    op.execute("""
        CREATE FUNCTION issue_private_session(
          tenant uuid, actor uuid, expected_verifier text,
          session_identifier uuid, session_digest char(64)
        ) RETURNS jsonb
        LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE stored_verifier text; current_role text; expiration timestamptz;
        BEGIN
          SELECT u.password_hash INTO stored_verifier
          FROM public.users u JOIN public.organizations o ON o.id=u.organization_id
          WHERE u.id=actor AND u.organization_id=tenant AND o.synthetic
            AND u.account_status='active' AND NOT u.is_local_operator
            AND split_part(u.email,'@',2)='example.invalid'
          FOR UPDATE OF u;
          IF NOT FOUND OR stored_verifier IS NULL OR expected_verifier IS NULL
            OR stored_verifier<>expected_verifier THEN RETURN NULL; END IF;
          SELECT r.role INTO current_role FROM public.user_role_assignments r
          WHERE r.organization_id=tenant AND r.user_id=actor
            AND (r.expires_at IS NULL OR r.expires_at>now())
          ORDER BY CASE r.role WHEN 'administrator' THEN 1
            WHEN 'specialist' THEN 2 ELSE 3 END LIMIT 1;
          IF current_role IS NULL THEN RETURN NULL; END IF;
          IF session_digest IS NULL OR session_digest !~ '^[0-9a-f]{64}$'
            THEN RAISE EXCEPTION 'Invalid session digest' USING ERRCODE='22023';
          END IF;
          expiration := now()+interval '8 hours';
          INSERT INTO public.auth_sessions(id,organization_id,user_id,token_sha256,expires_at)
          VALUES(session_identifier,tenant,actor,session_digest,expiration);
          RETURN jsonb_build_object('expires_at',expiration,'role',current_role);
        END $$;
        REVOKE ALL ON FUNCTION issue_private_session(uuid,uuid,text,uuid,char(64))
          FROM PUBLIC,bodyvision_app;
        GRANT EXECUTE ON FUNCTION issue_private_session(uuid,uuid,text,uuid,char(64))
          TO bodyvision_auth_app;
        REVOKE INSERT(id,organization_id,user_id,token_sha256,expires_at)
          ON auth_sessions FROM bodyvision_auth_app;
    """)
    op.execute("""
        CREATE FUNCTION reset_synthetic_password(
          session_digest char(64), subject uuid, administrator_verifier text,
          new_verifier text, event_identifier uuid, correlation uuid
        ) RETURNS jsonb
        LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE
          tenant uuid; actor uuid; actor_role text; current_verifier text; subject_email text;
          affected integer := 0; result_status text := 'forbidden';
        BEGIN
          SELECT r.org_id,r.actor_id,r.assigned_role INTO tenant,actor,actor_role
          FROM public.resolve_authenticated_session(session_digest) r;
          IF tenant IS NULL THEN RETURN jsonb_build_object('status','unauthorized'); END IF;
          IF actor_role='administrator' THEN
            SELECT u.password_hash INTO current_verifier FROM public.users u
            JOIN public.organizations o ON o.id=u.organization_id
            WHERE u.id=actor AND u.organization_id=tenant AND o.synthetic
              AND u.account_status='active' AND NOT u.is_local_operator
            FOR UPDATE OF u;
            IF current_verifier IS NULL OR administrator_verifier IS NULL
              OR current_verifier<>administrator_verifier THEN
              result_status := 'reauthentication-failed';
            ELSE
              -- Administrators, disabled accounts, self-service and cross-tenant
              -- targets are outside this synthetic support workflow.
              SELECT u.email INTO subject_email FROM public.users u
              WHERE u.id=subject AND u.organization_id=tenant AND u.id<>actor
                AND u.account_status='active' AND NOT u.is_local_operator
                AND split_part(u.email,'@',2)='example.invalid'
                AND EXISTS(SELECT 1 FROM public.user_role_assignments r
                  WHERE r.organization_id=tenant AND r.user_id=subject
                    AND r.role IN ('member','specialist')
                    AND (r.expires_at IS NULL OR r.expires_at>now()))
                AND NOT EXISTS(SELECT 1 FROM public.user_role_assignments r
                  WHERE r.organization_id=tenant AND r.user_id=subject
                    AND r.role='administrator')
              FOR UPDATE OF u;
              IF NOT FOUND THEN result_status := 'not-found';
              ELSE
                IF new_verifier IS NULL OR new_verifier !~
                  '^pbkdf2_sha256[$]600000[$][0-9a-f]{32}[$][0-9a-f]{64}$'
                THEN RAISE EXCEPTION 'Invalid verifier' USING ERRCODE='22023'; END IF;
                UPDATE public.users SET password_hash=new_verifier
                  WHERE id=subject AND organization_id=tenant;
                UPDATE public.auth_sessions SET revoked_at=clock_timestamp()
                  WHERE organization_id=tenant AND user_id=subject
                    AND revoked_at IS NULL;
                GET DIAGNOSTICS affected=ROW_COUNT;
                result_status := 'reset';
              END IF;
            END IF;
          END IF;
          INSERT INTO public.security_audit_events(
            id,organization_id,actor_id,correlation_id,action,resource_type,resource_id,outcome
          ) VALUES (
            event_identifier,tenant,actor,correlation,
            CASE WHEN result_status='reset' THEN 'admin.password_reset'
              ELSE 'admin.password_reset_denied' END,
            'user',CASE WHEN result_status='reset' THEN subject ELSE NULL END,
            CASE WHEN result_status='reset' THEN 'allowed' ELSE 'denied' END
          );
          RETURN jsonb_build_object('status',result_status,'revoked_sessions',affected,
            'login_email',CASE WHEN result_status='reset' THEN subject_email ELSE NULL END);
        END $$;
        REVOKE ALL ON FUNCTION reset_synthetic_password(char(64),uuid,text,text,uuid,uuid)
          FROM PUBLIC,bodyvision_app;
        GRANT EXECUTE ON FUNCTION reset_synthetic_password(char(64),uuid,text,text,uuid,uuid)
          TO bodyvision_auth_app;
    """)
    op.execute("UPDATE system_schema_state SET revision='0010_admin_password_reset'")


def downgrade() -> None:
    op.execute("DROP FUNCTION reset_synthetic_password(char(64),uuid,text,text,uuid,uuid)")
    op.execute("DROP FUNCTION issue_private_session(uuid,uuid,text,uuid,char(64))")
    op.execute(
        "GRANT INSERT(id,organization_id,user_id,token_sha256,expires_at) "
        "ON auth_sessions TO bodyvision_auth_app"
    )
    # Retain the safer helper search paths when returning to the older schema.
    op.execute("UPDATE system_schema_state SET revision='0009_private_consents'")
