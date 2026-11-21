"""Consent-gated fictional pose summaries and idempotency tombstones."""

from alembic import op

revision = "0020_pose_summaries"
down_revision = "0019_comparison_export"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE FUNCTION has_pose_summary_consent(target uuid) RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
          SELECT current_setting('app.identity_verified',true)='yes'
            AND has_profile_access(target) AND EXISTS (
              SELECT 1 FROM organizations o WHERE o.synthetic
                AND o.id=NULLIF(current_setting('app.organization_id',true),'')::uuid
            ) AND 2=(SELECT count(DISTINCT c.purpose) FROM profile_consents c
              WHERE c.organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
                AND c.profile_id=target AND c.purpose IN ('pose','storage')
                AND c.version='bv-synthetic-v1' AND c.status='accepted'
                AND c.accepted_at<=now() AND c.expires_at>now() AND c.revoked_at IS NULL
                AND c.cycle=(SELECT max(latest.cycle) FROM profile_consents latest
                  WHERE latest.organization_id=c.organization_id AND latest.profile_id=c.profile_id
                    AND latest.purpose=c.purpose AND latest.version=c.version))
        $$;
        CREATE FUNCTION lock_pose_summary_consent(target uuid) RETURNS boolean
        LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
        BEGIN
          PERFORM 1 FROM profile_consents c
            WHERE c.organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
              AND c.profile_id=target AND c.purpose IN ('pose','storage')
            ORDER BY c.id FOR SHARE OF c;
          RETURN has_pose_summary_consent(target);
        END $$;
        REVOKE ALL ON FUNCTION has_pose_summary_consent(uuid),lock_pose_summary_consent(uuid)
          FROM PUBLIC,bodyvision_auth_app;
        GRANT EXECUTE ON FUNCTION has_pose_summary_consent(uuid),lock_pose_summary_consent(uuid)
          TO bodyvision_app;

        CREATE TABLE synthetic_pose_summaries (
          id uuid PRIMARY KEY, organization_id uuid NOT NULL, profile_id uuid NOT NULL,
          created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
          model_revision text NOT NULL CHECK(model_revision='pose_landmarker_lite/float16/1'),
          algorithm_revision text NOT NULL CHECK(algorithm_revision='pose-review-summary-v1'),
          detected boolean NOT NULL, threshold numeric(4,3) NOT NULL
            CHECK(threshold BETWEEN .3 AND .9),
          visible_points integer NOT NULL CHECK(visible_points BETWEEN 0 AND 33),
          core_visible integer NOT NULL CHECK(core_visible BETWEEN 0 AND 8
            AND core_visible<=visible_points),
          quality_state text NOT NULL
            CHECK(quality_state IN ('not-detected','insufficient','caution','reviewable')),
          capture_passed boolean NOT NULL,
          summary_sha256 char(64) NOT NULL CHECK(summary_sha256 ~ '^[0-9a-f]{64}$'),
          FOREIGN KEY(organization_id,profile_id) REFERENCES profiles(organization_id,id),
          FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
          CHECK((NOT detected AND visible_points=0 AND core_visible=0
            AND quality_state='not-detected')
            OR (detected AND quality_state<>'not-detected')),
          CHECK(quality_state<>'reviewable' OR (capture_passed AND core_visible=8
            AND visible_points>=20))
        );
        CREATE INDEX pose_summary_history ON synthetic_pose_summaries
          (organization_id,profile_id,created_at DESC,id DESC);
        ALTER TABLE synthetic_pose_summaries ENABLE ROW LEVEL SECURITY;
        CREATE POLICY pose_summary_read ON synthetic_pose_summaries FOR SELECT USING (
          organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
          AND has_pose_summary_consent(profile_id));
        CREATE POLICY pose_summary_insert ON synthetic_pose_summaries FOR INSERT WITH CHECK (
          organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
          AND created_by=NULLIF(current_setting('app.actor_id',true),'')::uuid
          AND has_profile_access(profile_id,true) AND has_pose_summary_consent(profile_id));
        CREATE POLICY pose_summary_delete ON synthetic_pose_summaries FOR DELETE USING (
          organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
          AND current_setting('app.identity_verified',true)='yes'
            AND has_profile_access(profile_id,true));
        REVOKE ALL ON synthetic_pose_summaries FROM PUBLIC,bodyvision_app,bodyvision_auth_app;
        GRANT SELECT,INSERT ON synthetic_pose_summaries TO bodyvision_app;

        -- Kept after erasure: a lost response/retry cannot recreate an erased result.
        CREATE TABLE pose_summary_request_keys (
          organization_id uuid NOT NULL, user_id uuid NOT NULL, key uuid NOT NULL,
          profile_id uuid NOT NULL, result_id uuid NOT NULL,
          request_sha256 char(64) NOT NULL, PRIMARY KEY(organization_id,user_id,key),
          FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id),
          FOREIGN KEY(organization_id,profile_id) REFERENCES profiles(organization_id,id)
        );
        ALTER TABLE pose_summary_request_keys ENABLE ROW LEVEL SECURITY;
        CREATE POLICY pose_request_scope ON pose_summary_request_keys USING (
          organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
          AND user_id=NULLIF(current_setting('app.actor_id',true),'')::uuid
          AND current_setting('app.identity_verified',true)='yes'
            AND has_profile_access(profile_id,true))
          WITH CHECK (
          organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
          AND user_id=NULLIF(current_setting('app.actor_id',true),'')::uuid
          AND current_setting('app.identity_verified',true)='yes'
            AND has_profile_access(profile_id,true));
        REVOKE ALL ON pose_summary_request_keys FROM PUBLIC,bodyvision_app,bodyvision_auth_app;
        GRANT SELECT,INSERT ON pose_summary_request_keys TO bodyvision_app;

        CREATE FUNCTION purge_revoked_pose_summaries() RETURNS trigger
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
        DECLARE erase boolean:=false;
        BEGIN
          IF NEW.purpose IN ('pose','storage') THEN
            IF TG_OP='INSERT' THEN
              erase:=NEW.cycle>1;
            ELSE
              erase:=OLD.status='accepted' AND NEW.status='revoked';
            END IF;
            IF erase THEN
              DELETE FROM synthetic_pose_summaries
                WHERE organization_id=NEW.organization_id AND profile_id=NEW.profile_id;
            END IF;
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER pose_summary_consent_renewal AFTER INSERT ON profile_consents
          FOR EACH ROW EXECUTE FUNCTION purge_revoked_pose_summaries();
        CREATE TRIGGER pose_summary_consent_erasure AFTER UPDATE OF status ON profile_consents
          FOR EACH ROW EXECUTE FUNCTION purge_revoked_pose_summaries();
        REVOKE ALL ON FUNCTION purge_revoked_pose_summaries()
          FROM PUBLIC,bodyvision_app,bodyvision_auth_app;

        CREATE FUNCTION audit_pose_summary(
          event_id uuid,correlation uuid,target uuid,event_name text)
        RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
        DECLARE tenant uuid; actor uuid; writing boolean;
        BEGIN
          tenant:=NULLIF(current_setting('app.organization_id',true),'')::uuid;
          actor:=NULLIF(current_setting('app.actor_id',true),'')::uuid;
          writing:=event_name IN ('pose.create','pose.delete');
          IF current_setting('app.identity_verified',true) IS DISTINCT FROM 'yes'
            OR correlation IS NULL OR event_name NOT
            IN ('pose.create','pose.read','pose.list','pose.delete')
            OR NOT has_profile_access(target,writing) OR NOT EXISTS (
              SELECT 1 FROM users u JOIN organizations o ON o.id=u.organization_id
              WHERE u.id=actor AND o.id=tenant AND o.synthetic AND u.account_status='active'
                AND NOT u.is_local_operator) THEN
            RAISE EXCEPTION 'Verified pose context required' USING ERRCODE='42501';
          END IF;
          IF writing AND NOT EXISTS (SELECT 1 FROM user_role_assignments r
            WHERE r.organization_id=tenant AND r.user_id=actor
              AND r.role IN ('administrator','specialist')
              AND (r.expires_at IS NULL OR r.expires_at>now())) THEN
            RAISE EXCEPTION 'Pose writer required' USING ERRCODE='42501';
          END IF;
          INSERT INTO security_audit_events(id,organization_id,actor_id,correlation_id,
            action,resource_type,resource_id,outcome)
          VALUES(event_id,tenant,actor,correlation,event_name,'profile',target,'allowed');
          RETURN true;
        END $$;
        REVOKE ALL ON FUNCTION audit_pose_summary(uuid,uuid,uuid,text)
          FROM PUBLIC,bodyvision_auth_app;
        GRANT EXECUTE ON FUNCTION audit_pose_summary(uuid,uuid,uuid,text) TO bodyvision_app;
        CREATE FUNCTION erase_pose_summary(
          target uuid,identifier uuid,event_id uuid,correlation uuid)
        RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
        BEGIN
          PERFORM audit_pose_summary(event_id,correlation,target,'pose.delete');
          DELETE FROM synthetic_pose_summaries
            WHERE organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
              AND profile_id=target AND id=identifier;
          RETURN FOUND;
        END $$;
        REVOKE ALL ON FUNCTION erase_pose_summary(uuid,uuid,uuid,uuid)
          FROM PUBLIC,bodyvision_auth_app;
        GRANT EXECUTE ON FUNCTION erase_pose_summary(uuid,uuid,uuid,uuid) TO bodyvision_app;
        UPDATE system_schema_state SET revision='0020_pose_summaries';
    """)


def downgrade():
    op.execute("""
        DROP FUNCTION erase_pose_summary(uuid,uuid,uuid,uuid);
        DROP FUNCTION audit_pose_summary(uuid,uuid,uuid,text);
        DROP TRIGGER pose_summary_consent_erasure ON profile_consents;
        DROP TRIGGER pose_summary_consent_renewal ON profile_consents;
        DROP FUNCTION purge_revoked_pose_summaries();
        DROP TABLE pose_summary_request_keys;
        DROP TABLE synthetic_pose_summaries;
        DROP FUNCTION lock_pose_summary_consent(uuid);
        DROP FUNCTION has_pose_summary_consent(uuid);
        UPDATE system_schema_state SET revision='0019_comparison_export';
    """)
