"""Foundation metadata only. No personal data or tenant tables in phase 1."""

import sqlalchemy as sa

from alembic import op

revision = "0001_foundation"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    table = op.create_table(
        "system_schema_state",
        sa.Column("singleton", sa.Boolean(), primary_key=True),
        sa.Column("revision", sa.String(64), nullable=False),
        sa.CheckConstraint("singleton = true", name="single_schema_state"),
    )
    op.bulk_insert(table, [{"singleton": True, "revision": revision}])
    op.execute("REVOKE ALL ON system_schema_state FROM PUBLIC")
    op.execute("GRANT SELECT ON system_schema_state TO bodyvision_app")


def downgrade() -> None:
    op.drop_table("system_schema_state")
