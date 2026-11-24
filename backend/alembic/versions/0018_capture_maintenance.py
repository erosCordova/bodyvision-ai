"""Bounded retention maintenance and consent-scoped Fernet key rotation."""

from alembic import op

revision = "0018_capture_maintenance"
down_revision = "0017_synthetic_captures"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        -- Only the data role can call this deliberately narrow maintenance
        -- function. It cannot select plaintext or arbitrary tenant rows.
        CREATE TABLE synthetic_capture_maintenance_events (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          executed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
          action varchar(32) NOT NULL CHECK (action='retention.purge'),
          deleted_count integer NOT NULL CHECK (deleted_count BETWEEN 0 AND 100),
          run_kind varchar(20) NOT NULL DEFAULT 'scheduled'
            CHECK (run_kind='scheduled')
        );
        REVOKE ALL ON synthetic_capture_maintenance_events
          FROM PUBLIC,bodyvision_app,bodyvision_auth_app;

        CREATE FUNCTION purge_expired_synthetic_capture_batch(maximum integer DEFAULT 100)
        RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE removed integer;
        BEGIN
          -- An authenticated HTTP request always has a tenant/actor context,
          -- whereas the maintenance task has none. Do not let a request run
          -- global cleanup using its scoped connection.
          IF maximum IS NULL OR maximum NOT BETWEEN 1 AND 100 OR
             NULLIF(current_setting('app.organization_id',true),'') IS NOT NULL OR
             NULLIF(current_setting('app.actor_id',true),'') IS NOT NULL OR
             current_setting('app.identity_verified',true)='yes'
          THEN RAISE EXCEPTION 'Maintenance context required' USING ERRCODE='42501';
          END IF;

          -- Multiple replicas may wake simultaneously: serialize the batch
          -- and lock individual rows without blocking consent revocation.
          IF NOT pg_try_advisory_xact_lock(46113,18) THEN
            RETURN 0;
          END IF;
          WITH eligible AS (
            SELECT c.id FROM public.synthetic_capture_objects c
             WHERE c.expires_at<=clock_timestamp()
             ORDER BY c.expires_at,c.id LIMIT maximum
             FOR UPDATE SKIP LOCKED
          ), deleted AS (
            DELETE FROM public.synthetic_capture_objects c
             USING eligible e WHERE c.id=e.id
             RETURNING c.id
          ) SELECT count(*)::integer INTO removed FROM deleted;

          INSERT INTO public.synthetic_capture_maintenance_events(action,deleted_count)
            VALUES('retention.purge',removed);
          RETURN removed;
        END $$;
        REVOKE ALL ON FUNCTION purge_expired_synthetic_capture_batch(integer)
          FROM PUBLIC,bodyvision_auth_app,bodyvision_app;
        GRANT EXECUTE ON FUNCTION purge_expired_synthetic_capture_batch(integer)
          TO bodyvision_app;

        GRANT UPDATE(ciphertext) ON synthetic_capture_objects TO bodyvision_app;
        CREATE POLICY synthetic_capture_rotate ON synthetic_capture_objects FOR UPDATE
          USING (
            organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
            AND current_setting('app.identity_verified',true)='yes'
            AND has_profile_access(profile_id,true)
          )
          WITH CHECK (
            organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
            AND current_setting('app.identity_verified',true)='yes'
            AND has_profile_access(profile_id,true)
          );

        CREATE OR REPLACE FUNCTION audit_synthetic_capture(
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
                                    'capture.delete','capture.purge','capture.rotate')
          THEN RAISE EXCEPTION 'Verified capture context required' USING ERRCODE='42501';
          END IF;
          IF NOT EXISTS(
            SELECT 1 FROM public.users u JOIN public.organizations o
              ON o.id=u.organization_id
            WHERE u.id=actor AND u.organization_id=tenant AND o.synthetic
              AND u.account_status='active' AND NOT u.is_local_operator
          ) OR NOT has_profile_access(
            profile_uuid,action_name IN (
              'capture.create','capture.delete','capture.purge','capture.rotate'
            )
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

        UPDATE system_schema_state SET revision='0018_capture_maintenance';
    """)


def downgrade() -> None:
    # Preserve current encrypted media, but revert the previously allowed
    # audited action and database permission. Never decrypt or drop captures.
    op.execute("""
        DROP POLICY synthetic_capture_rotate ON synthetic_capture_objects;
        REVOKE UPDATE(ciphertext) ON synthetic_capture_objects FROM bodyvision_app;
        DROP FUNCTION purge_expired_synthetic_capture_batch(integer);
        DROP TABLE synthetic_capture_maintenance_events;
        CREATE OR REPLACE FUNCTION audit_synthetic_capture(
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
        UPDATE system_schema_state SET revision='0017_synthetic_captures';
    """)
