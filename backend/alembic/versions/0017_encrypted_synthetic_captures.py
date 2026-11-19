"""Small encrypted synthetic-only PNG captures with scoped consent gates."""

from alembic import op

revision = "0017_synthetic_captures"
down_revision = "0016_simulation_scenarios"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE synthetic_capture_objects (
          id uuid PRIMARY KEY,
          organization_id uuid NOT NULL,
          profile_id uuid NOT NULL,
          created_by uuid NOT NULL,
          format varchar(10) NOT NULL DEFAULT 'image/png'
            CHECK(format='image/png'),
          original_bytes integer NOT NULL CHECK(original_bytes BETWEEN 80 AND 262144),
          width integer NOT NULL CHECK(width BETWEEN 1 AND 1024),
          height integer NOT NULL CHECK(height BETWEEN 1 AND 1024),
          sha256_digest char(64) NOT NULL,
          ciphertext bytea NOT NULL CHECK(octet_length(ciphertext)>80),
          created_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL DEFAULT (now()+interval '7 days'),
          UNIQUE(organization_id,id),
          FOREIGN KEY(organization_id,profile_id)
            REFERENCES profiles(organization_id,id),
          FOREIGN KEY(organization_id,created_by)
            REFERENCES users(organization_id,id),
          CHECK(expires_at>created_at AND expires_at<=created_at+interval '7 days')
        );
        CREATE INDEX synthetic_captures_profile_history ON synthetic_capture_objects
          (organization_id,profile_id,created_at DESC,id);

        ALTER TABLE synthetic_capture_objects ENABLE ROW LEVEL SECURITY;
        CREATE POLICY synthetic_capture_select ON synthetic_capture_objects FOR SELECT
          USING (
            organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
            AND has_profile_access(profile_id)
            AND current_setting('app.identity_verified',true)='yes'
          );
        CREATE POLICY synthetic_capture_insert ON synthetic_capture_objects FOR INSERT
          WITH CHECK (
            organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
            AND created_by=NULLIF(current_setting('app.actor_id',true),'')::uuid
            AND current_setting('app.identity_verified',true)='yes'
            AND has_profile_access(profile_id,true)
          );
        CREATE POLICY synthetic_capture_delete ON synthetic_capture_objects FOR DELETE
          USING (
            organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
            AND current_setting('app.identity_verified',true)='yes'
            AND has_profile_access(profile_id,true)
          );
        REVOKE ALL ON synthetic_capture_objects FROM PUBLIC,bodyvision_auth_app,bodyvision_app;
        GRANT SELECT,INSERT,DELETE ON synthetic_capture_objects TO bodyvision_app;

        -- Consent is evaluated against the latest cycle of the exact synthetic
        -- policy; the row locks prevent revocation racing with an upload/read.
        CREATE FUNCTION lock_current_synthetic_capture_consent(target_profile uuid)
        RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE number_valid integer;
        BEGIN
          IF current_setting('app.identity_verified',true) IS DISTINCT FROM 'yes'
             OR NULLIF(current_setting('app.organization_id',true),'') IS NULL
             OR NULLIF(current_setting('app.actor_id',true),'') IS NULL
          THEN RETURN false; END IF;
          PERFORM 1 FROM public.profile_consents c
            WHERE c.organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
              AND c.profile_id=target_profile AND c.purpose IN ('capture','storage')
              AND c.version='bv-synthetic-v1' AND c.status='accepted'
              AND c.accepted_at<=now() AND c.revoked_at IS NULL
              AND c.expires_at>now()
            FOR SHARE OF c;
          SELECT count(DISTINCT c.purpose) INTO number_valid
            FROM public.profile_consents c
            WHERE c.organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
              AND c.profile_id=target_profile AND c.purpose IN ('capture','storage')
              AND c.version='bv-synthetic-v1' AND c.status='accepted'
              AND c.accepted_at<=now() AND c.revoked_at IS NULL
              AND c.expires_at>now()
              AND c.cycle=(SELECT max(latest.cycle)
                FROM public.profile_consents latest
                WHERE latest.organization_id=c.organization_id
                  AND latest.profile_id=c.profile_id AND latest.purpose=c.purpose
                  AND latest.version=c.version);
          RETURN number_valid=2;
        END $$;
        REVOKE ALL ON FUNCTION lock_current_synthetic_capture_consent(uuid)
          FROM PUBLIC,bodyvision_auth_app;
        GRANT EXECUTE ON FUNCTION lock_current_synthetic_capture_consent(uuid)
          TO bodyvision_app;

        -- Audit is part of the same transaction as the encrypted record.
        CREATE FUNCTION audit_synthetic_capture(
          event_uuid uuid, correlation_uuid uuid, profile_uuid uuid, action_name text
        ) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE tenant uuid; actor uuid;
        BEGIN
          tenant := NULLIF(current_setting('app.organization_id',true),'')::uuid;
          actor := NULLIF(current_setting('app.actor_id',true),'')::uuid;
          IF current_setting('app.identity_verified',true) IS DISTINCT FROM 'yes'
             OR tenant IS NULL OR actor IS NULL OR profile_uuid IS NULL
             OR event_uuid IS NULL OR correlation_uuid IS NULL
             OR action_name NOT IN ('capture.create','capture.list','capture.read',
                                    'capture.delete','capture.purge')
          THEN RAISE EXCEPTION 'Verified capture context required' USING ERRCODE='42501';
          END IF;
          IF NOT EXISTS(
            SELECT 1 FROM public.users u JOIN public.organizations o
              ON o.id=u.organization_id
            WHERE u.id=actor AND u.organization_id=tenant AND o.synthetic
              AND u.account_status='active' AND NOT u.is_local_operator
          ) OR NOT has_profile_access(
            profile_uuid,action_name IN ('capture.create','capture.delete','capture.purge')
          ) THEN
            RAISE EXCEPTION 'Capture access denied' USING ERRCODE='42501';
          END IF;
          INSERT INTO public.security_audit_events(
            id,organization_id,actor_id,correlation_id,action,
            resource_type,resource_id,outcome
          ) VALUES(
            event_uuid,tenant,actor,correlation_uuid,action_name,
            'profile',profile_uuid,'allowed'
          );
          RETURN true;
        END $$;
        REVOKE ALL ON FUNCTION audit_synthetic_capture(uuid,uuid,uuid,text)
          FROM PUBLIC,bodyvision_auth_app;
        GRANT EXECUTE ON FUNCTION audit_synthetic_capture(uuid,uuid,uuid,text)
          TO bodyvision_app;

        -- On revocation of either required purpose, hard-delete stored ciphertext
        -- in the same transaction; audit of the consent persists separately.
        CREATE FUNCTION purge_revoked_synthetic_captures() RETURNS trigger
          LANGUAGE plpgsql SECURITY DEFINER
          SET search_path=pg_catalog,public,pg_temp AS $$
        BEGIN
          IF OLD.status='accepted' AND NEW.status='revoked'
             AND NEW.purpose IN ('capture','storage') THEN
             DELETE FROM public.synthetic_capture_objects
               WHERE organization_id=NEW.organization_id AND profile_id=NEW.profile_id;
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER purge_captures_on_consent_revoke
          AFTER UPDATE OF status ON profile_consents
          FOR EACH ROW EXECUTE FUNCTION purge_revoked_synthetic_captures();
        REVOKE ALL ON FUNCTION purge_revoked_synthetic_captures()
          FROM PUBLIC,bodyvision_app,bodyvision_auth_app;
        UPDATE system_schema_state SET revision='0017_synthetic_captures';
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER purge_captures_on_consent_revoke ON profile_consents")
    op.execute("DROP FUNCTION purge_revoked_synthetic_captures()")
    op.execute("DROP FUNCTION audit_synthetic_capture(uuid,uuid,uuid,text)")
    op.execute("DROP FUNCTION lock_current_synthetic_capture_consent(uuid)")
    op.execute("DROP TABLE synthetic_capture_objects")
    op.execute("UPDATE system_schema_state SET revision='0016_simulation_scenarios'")
