"""MFA storage: encrypted seeds, replay counters and single-use backup hashes.

No application role has direct access. A later migration will introduce narrow,
authenticated SECURITY DEFINER enrollment and challenge routines.
"""

from alembic import op

revision = "0013_mfa_foundation"
down_revision = "0012_account_security"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE public.private_mfa_credentials (
          organization_id uuid NOT NULL,
          user_id uuid NOT NULL,
          encrypted_totp_seed text NOT NULL,
          enrolled_at timestamptz NOT NULL DEFAULT now(),
          confirmed_at timestamptz,
          last_accepted_step bigint NOT NULL DEFAULT -1 CHECK(last_accepted_step >= -1),
          PRIMARY KEY(organization_id,user_id),
          FOREIGN KEY(organization_id,user_id) REFERENCES public.users(organization_id,id)
            ON DELETE CASCADE,
          CHECK(length(encrypted_totp_seed) BETWEEN 80 AND 512)
        );
        CREATE TABLE public.private_mfa_recovery_codes (
          id uuid PRIMARY KEY,
          organization_id uuid NOT NULL,
          user_id uuid NOT NULL,
          code_verifier varchar(150) NOT NULL
            CHECK(code_verifier ~ '^pbkdf2_sha256[$]600000[$][0-9a-f]{32}[$][0-9a-f]{64}$'),
          created_at timestamptz NOT NULL DEFAULT now(),
          consumed_at timestamptz,
          FOREIGN KEY(organization_id,user_id)
            REFERENCES public.private_mfa_credentials(organization_id,user_id)
            ON DELETE CASCADE,
          CHECK(consumed_at IS NULL OR consumed_at>=created_at)
        );
        CREATE INDEX private_mfa_recovery_active ON public.private_mfa_recovery_codes
          (organization_id,user_id) WHERE consumed_at IS NULL;
    """)
    for table in ("private_mfa_credentials", "private_mfa_recovery_codes"):
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"REVOKE ALL ON public.{table} FROM PUBLIC,bodyvision_app,bodyvision_auth_app")
    op.execute("UPDATE system_schema_state SET revision='0013_mfa_foundation'")


def downgrade() -> None:
    op.execute("DROP TABLE public.private_mfa_recovery_codes")
    op.execute("DROP TABLE public.private_mfa_credentials")
    op.execute("UPDATE system_schema_state SET revision='0012_account_security'")
