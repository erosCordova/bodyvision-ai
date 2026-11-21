"""Bounded deletion of fictional pose summaries after consent becomes invalid."""

from alembic import op

revision = "0021_pose_retention"
down_revision = "0020_pose_summaries"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE FUNCTION purge_expired_pose_summary_batch(batch_limit integer)
        RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
        SET search_path=pg_catalog,public AS $$
        DECLARE deleted_count integer;
        BEGIN
          IF batch_limit IS NULL OR batch_limit NOT BETWEEN 1 AND 100 THEN
            RAISE EXCEPTION 'Invalid pose retention batch' USING ERRCODE='22023';
          END IF;
          WITH due AS (
            SELECT s.id FROM synthetic_pose_summaries s
            JOIN organizations o ON o.id=s.organization_id AND o.synthetic
            WHERE EXISTS (
              SELECT 1 FROM profile_consents c
              WHERE c.organization_id=s.organization_id AND c.profile_id=s.profile_id
                AND c.purpose IN ('pose','storage')
            )
            AND EXISTS (
              SELECT 1 FROM (VALUES ('pose'),('storage')) AS needed(purpose)
              WHERE NOT EXISTS (
                SELECT 1 FROM profile_consents c
                WHERE c.organization_id=s.organization_id AND c.profile_id=s.profile_id
                  AND c.purpose=needed.purpose AND c.version='bv-synthetic-v1'
                  AND c.status='accepted' AND c.revoked_at IS NULL
                  AND c.accepted_at<=now() AND c.expires_at>now()
                  AND c.cycle=(
                    SELECT max(latest.cycle) FROM profile_consents latest
                    WHERE latest.organization_id=c.organization_id
                      AND latest.profile_id=c.profile_id
                      AND latest.purpose=c.purpose AND latest.version=c.version
                  )
              )
            )
            ORDER BY s.created_at,s.id LIMIT batch_limit FOR UPDATE OF s SKIP LOCKED
          )
          DELETE FROM synthetic_pose_summaries s USING due WHERE s.id=due.id;
          GET DIAGNOSTICS deleted_count=ROW_COUNT;
          RETURN deleted_count;
        END $$;
        REVOKE ALL ON FUNCTION purge_expired_pose_summary_batch(integer)
          FROM PUBLIC,bodyvision_auth_app;
        GRANT EXECUTE ON FUNCTION purge_expired_pose_summary_batch(integer)
          TO bodyvision_app;
        UPDATE system_schema_state SET revision='0021_pose_retention';
    """)


def downgrade():
    op.execute("""
        DROP FUNCTION purge_expired_pose_summary_batch(integer);
        UPDATE system_schema_state SET revision='0020_pose_summaries';
    """)
