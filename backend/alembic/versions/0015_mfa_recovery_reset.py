"""Password + one-use backup code permits atomic, auditable factor replacement.

Synthetic local/test only. The owner of the database reviews initial enrollment;
this routine does not provide an unverified administrator bootstrap.
"""

from alembic import op

revision = "0015_mfa_recovery_reset"
down_revision = "0014_mfa_step_up"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE FUNCTION public.private_mfa_reset_with_recovery(
          tenant uuid, actor uuid, expected_verifier text,
          recovery_identifier uuid, recovery_verifier text,
          new_ciphertext text, event_identifier uuid, correlation uuid
        ) RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE stored_verifier text; factor_confirmed timestamptz; consumed integer := 0;
        BEGIN
          IF new_ciphertext IS NULL OR length(new_ciphertext) NOT BETWEEN 80 AND 512
            OR expected_verifier IS NULL OR recovery_identifier IS NULL
            OR recovery_verifier IS NULL THEN RETURN 'denied'; END IF;

          -- All MFA changes, credential rotations, and session issuance lock
          -- the same users row. A stale password or concurrent recovery fails.
          SELECT u.password_hash INTO stored_verifier
            FROM public.users u JOIN public.organizations o
              ON o.id=u.organization_id
            WHERE u.id=actor AND u.organization_id=tenant AND o.synthetic
              AND u.account_status='active' AND NOT u.is_local_operator
              AND split_part(u.email,'@',2)='example.invalid'
              AND EXISTS(
                SELECT 1 FROM public.user_role_assignments r
                WHERE r.organization_id=tenant AND r.user_id=actor
                  AND r.role IN ('administrator','specialist')
                  AND (r.expires_at IS NULL OR r.expires_at>now()))
            FOR UPDATE OF u;
          IF NOT FOUND OR stored_verifier<>expected_verifier
            THEN RETURN 'denied'; END IF;

          SELECT confirmed_at INTO factor_confirmed
            FROM public.private_mfa_credentials
            WHERE organization_id=tenant AND user_id=actor FOR UPDATE;
          IF NOT FOUND OR factor_confirmed IS NULL THEN RETURN 'denied'; END IF;

          -- Use a non-consumed recovery verifier, not a caller-supplied bool.
          UPDATE public.private_mfa_recovery_codes SET consumed_at=clock_timestamp()
            WHERE id=recovery_identifier AND organization_id=tenant AND user_id=actor
              AND code_verifier=recovery_verifier AND consumed_at IS NULL;
          GET DIAGNOSTICS consumed=ROW_COUNT;
          IF consumed<>1 THEN RETURN 'denied'; END IF;

          UPDATE public.private_mfa_credentials
            SET encrypted_totp_seed=new_ciphertext,confirmed_at=NULL,
                last_accepted_step=-1,enrolled_at=clock_timestamp()
            WHERE organization_id=tenant AND user_id=actor;
          -- Even unused backup codes from the former factor are invalid now.
          DELETE FROM public.private_mfa_recovery_codes
            WHERE organization_id=tenant AND user_id=actor;
          UPDATE public.auth_sessions SET revoked_at=clock_timestamp()
            WHERE organization_id=tenant AND user_id=actor
              AND revoked_at IS NULL;
          INSERT INTO public.security_audit_events(
            id,organization_id,actor_id,correlation_id,action,
            resource_type,resource_id,outcome
          ) VALUES(
            event_identifier,tenant,actor,correlation,
            'mfa.factor_recovery_started','user',actor,'allowed'
          );
          RETURN 'ok';
        END $$;
    """)
    signature = "private_mfa_reset_with_recovery(uuid,uuid,text,uuid,text,text,uuid,uuid)"
    op.execute(f"REVOKE ALL ON FUNCTION public.{signature} FROM PUBLIC,bodyvision_app")
    op.execute(f"GRANT EXECUTE ON FUNCTION public.{signature} TO bodyvision_auth_app")
    op.execute("UPDATE system_schema_state SET revision='0015_mfa_recovery_reset'")


def downgrade() -> None:
    op.execute(
        "DROP FUNCTION public.private_mfa_reset_with_recovery("
        "uuid,uuid,text,uuid,text,text,uuid,uuid)"
    )
    op.execute("UPDATE system_schema_state SET revision='0014_mfa_step_up'")
