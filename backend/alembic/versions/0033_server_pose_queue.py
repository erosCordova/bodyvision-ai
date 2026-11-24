"""Durable, synthetic-only server pose queue with a separate least-privilege worker."""

from alembic import op

revision = "0033_server_pose_queue"
down_revision = "0032_privacy_rejection"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='bodyvision_pose_worker') THEN
            CREATE ROLE bodyvision_pose_worker NOLOGIN NOSUPERUSER NOCREATEDB
              NOCREATEROLE NOINHERIT NOBYPASSRLS;
          END IF;
        END $$;
        GRANT USAGE ON SCHEMA public TO bodyvision_pose_worker;
        ALTER TABLE public.synthetic_capture_objects
          ADD CONSTRAINT pose_capture_scope_key UNIQUE(organization_id,profile_id,id);
        CREATE TABLE public.server_pose_jobs (
          id uuid PRIMARY KEY, organization_id uuid NOT NULL, profile_id uuid NOT NULL,
          capture_id uuid NOT NULL UNIQUE, requested_by uuid NOT NULL,
          status text NOT NULL DEFAULT 'queued' CHECK(status IN
            ('queued','processing','needs_review','failed','accepted','rejected')),
          attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
          run_after timestamptz NOT NULL DEFAULT clock_timestamp(),
          lease_until timestamptz, lease_token uuid,
          created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
          finished_at timestamptz, reviewed_at timestamptz, reviewed_by uuid,
          result jsonb, error_code text,
          FOREIGN KEY(organization_id,profile_id,capture_id)
            REFERENCES public.synthetic_capture_objects(organization_id,profile_id,id)
            ON DELETE CASCADE,
          FOREIGN KEY(organization_id,requested_by) REFERENCES public.users(organization_id,id),
          FOREIGN KEY(organization_id,reviewed_by) REFERENCES public.users(organization_id,id),
          CHECK((status='processing')=(lease_until IS NOT NULL AND lease_token IS NOT NULL)),
          CHECK(error_code IS NULL OR error_code IN
            ('MODEL_UNAVAILABLE','INFERENCE_FAILED','CAPTURE_INVALID','CONSENT_REQUIRED','TIMEOUT')),
          CHECK(result IS NULL OR jsonb_typeof(result)='object')
        );
        CREATE INDEX pose_job_due ON public.server_pose_jobs(status,run_after,created_at);
        ALTER TABLE public.server_pose_jobs ENABLE ROW LEVEL SECURITY;
        CREATE POLICY server_pose_job_read ON public.server_pose_jobs FOR SELECT USING (
          organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
          AND current_setting('app.identity_verified',true)='yes'
          AND public.has_profile_access(profile_id)
          AND NOT public.is_private_privacy_actor()
          AND EXISTS (SELECT 1 FROM public.synthetic_capture_objects c
            WHERE c.id=capture_id AND c.expires_at>now())
        );
        REVOKE ALL ON public.server_pose_jobs
          FROM PUBLIC,bodyvision_app,bodyvision_auth_app,bodyvision_pose_worker;
        GRANT SELECT(id,organization_id,profile_id,capture_id,status,attempts,created_at,
                     finished_at,reviewed_at,result,error_code)
          ON public.server_pose_jobs TO bodyvision_app;

        -- The worker has no general access to accounts, images or job tables.
        -- A current grant and all three consent purposes are checked on each claim.
        CREATE FUNCTION public.server_pose_authorized(tenant uuid,subject uuid,actor uuid)
          RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
          SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE valid_count integer;
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM public.profiles p JOIN public.organizations o ON o.id=p.organization_id
            JOIN public.users u ON u.organization_id=o.id AND u.id=actor
            WHERE p.id=subject AND p.organization_id=tenant AND p.status='active'
              AND o.synthetic AND u.account_status='active' AND NOT u.is_local_operator
              AND EXISTS (SELECT 1 FROM public.profile_access a
                WHERE a.organization_id=tenant AND a.profile_id=subject AND a.user_id=actor
                  AND a.access_level IN ('write','manage')
                  AND (a.expires_at IS NULL OR a.expires_at>now()))
              AND EXISTS (SELECT 1 FROM public.user_role_assignments r
                WHERE r.organization_id=tenant AND r.user_id=actor
                  AND r.role IN ('administrator','specialist')
                  AND (r.expires_at IS NULL OR r.expires_at>now()))
          ) THEN RETURN false; END IF;
          PERFORM 1 FROM public.profile_consents c
            WHERE c.organization_id=tenant AND c.profile_id=subject
              AND c.purpose IN ('pose','capture','storage') AND c.version='bv-synthetic-v1'
            ORDER BY c.id FOR SHARE OF c;
          SELECT count(DISTINCT c.purpose) INTO valid_count FROM public.profile_consents c
            WHERE c.organization_id=tenant AND c.profile_id=subject
              AND c.purpose IN ('pose','capture','storage') AND c.version='bv-synthetic-v1'
              AND c.status='accepted' AND c.revoked_at IS NULL AND c.accepted_at<=now()
              AND c.expires_at>now()
              AND c.cycle=(SELECT max(z.cycle) FROM public.profile_consents z
                WHERE z.organization_id=tenant AND z.profile_id=subject
                  AND z.purpose=c.purpose AND z.version=c.version);
          RETURN valid_count=3;
        END $$;
        REVOKE ALL ON FUNCTION public.server_pose_authorized(uuid,uuid,uuid)
          FROM PUBLIC,bodyvision_app,bodyvision_auth_app,bodyvision_pose_worker;

        CREATE FUNCTION public.enqueue_server_pose(
          job uuid,subject uuid,capture uuid,event_id uuid,correlation uuid
        ) RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
          SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE tenant uuid; actor uuid; existing uuid;
        BEGIN
          tenant:=NULLIF(current_setting('app.organization_id',true),'')::uuid;
          actor:=NULLIF(current_setting('app.actor_id',true),'')::uuid;
          IF current_setting('app.identity_verified',true) IS DISTINCT FROM 'yes'
            OR NOT public.server_pose_authorized(tenant,subject,actor)
          THEN RETURN NULL; END IF;
          PERFORM 1 FROM public.synthetic_capture_objects c WHERE c.id=capture
            AND c.organization_id=tenant AND c.profile_id=subject AND c.expires_at>now()
            FOR SHARE OF c;
          IF NOT FOUND THEN RETURN NULL; END IF;
          INSERT INTO public.server_pose_jobs(id,organization_id,profile_id,capture_id,requested_by)
            VALUES(job,tenant,subject,capture,actor) ON CONFLICT(capture_id) DO NOTHING
            RETURNING id INTO existing;
          IF existing IS NULL THEN
            SELECT j.id INTO existing FROM public.server_pose_jobs j WHERE j.capture_id=capture;
          ELSE
            INSERT INTO public.security_audit_events
              (id,organization_id,actor_id,correlation_id,action,resource_type,resource_id,outcome)
              VALUES(event_id,tenant,actor,correlation,'pose.server.queued','profile',subject,'allowed');
          END IF;
          RETURN existing;
        END $$;

        CREATE FUNCTION public.claim_server_pose(token uuid)
          RETURNS TABLE(job_id uuid) LANGUAGE plpgsql VOLATILE SECURITY DEFINER
          SET search_path=pg_catalog,public,pg_temp AS $$
        BEGIN
          -- Recover abandoned final attempts in bounded batches, never reset attempt counts.
          WITH exhausted AS (
            SELECT j.id FROM public.server_pose_jobs j WHERE j.status='processing'
              AND j.lease_until<=clock_timestamp() AND j.attempts>=3
            LIMIT 100 FOR UPDATE SKIP LOCKED
          ) UPDATE public.server_pose_jobs j SET status='failed',error_code='TIMEOUT',
            finished_at=clock_timestamp(),lease_token=NULL,lease_until=NULL
            FROM exhausted e WHERE j.id=e.id;
          RETURN QUERY WITH candidate AS (
            SELECT j.id FROM public.server_pose_jobs j
              WHERE j.attempts<3 AND ((j.status='queued' AND j.run_after<=clock_timestamp())
                OR (j.status='processing' AND j.lease_until<=clock_timestamp()))
              ORDER BY j.run_after,j.created_at,j.id LIMIT 1 FOR UPDATE SKIP LOCKED
          ) UPDATE public.server_pose_jobs j SET status='processing',attempts=j.attempts+1,
            lease_token=token,lease_until=clock_timestamp()+interval '90 seconds',error_code=NULL
            FROM candidate c WHERE j.id=c.id RETURNING j.id;
        END $$;

        CREATE FUNCTION public.read_server_pose(job uuid,token uuid)
          RETURNS TABLE(ciphertext bytea,sha256_digest char(64))
          LANGUAGE plpgsql VOLATILE SECURITY DEFINER
          SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE entry public.server_pose_jobs%ROWTYPE;
        BEGIN
          SELECT * INTO entry FROM public.server_pose_jobs j WHERE j.id=job
            AND j.status='processing' AND j.lease_token=token AND j.lease_until>clock_timestamp();
          IF NOT FOUND OR NOT public.server_pose_authorized(
            entry.organization_id,entry.profile_id,entry.requested_by) THEN RETURN; END IF;
          RETURN QUERY SELECT c.ciphertext,c.sha256_digest FROM public.synthetic_capture_objects c
            WHERE c.id=entry.capture_id AND c.organization_id=entry.organization_id
              AND c.profile_id=entry.profile_id AND c.expires_at>clock_timestamp() FOR SHARE OF c;
        END $$;

        CREATE FUNCTION public.finish_server_pose(job uuid,token uuid,output jsonb,problem text)
          RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
          SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE changed uuid;
        BEGIN
          IF (output IS NULL)=(problem IS NULL) THEN
            RAISE EXCEPTION 'Exactly one pose outcome required' USING ERRCODE='22023';
          END IF;
          IF output IS NOT NULL AND (jsonb_typeof(output)<>'object'
            OR NOT output ?& ARRAY['detected','visible_points','model_sha256','model_revision']
            OR (output-ARRAY['detected','visible_points','model_sha256','model_revision'])<>'{}'
            OR output->>'model_sha256'<>
              '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a'
            OR output->>'model_revision'<>'pose_landmarker_lite/float16/1'
            OR jsonb_typeof(output->'detected')<>'boolean'
            OR jsonb_typeof(output->'visible_points')<>'number'
            OR (output->>'visible_points') !~ '^([0-9]|[12][0-9]|3[0-3])$'
            OR ((output->>'detected')='false' AND (output->>'visible_points')<>'0'))
          THEN RAISE EXCEPTION 'Invalid pose output' USING ERRCODE='22023'; END IF;
          IF problem IS NOT NULL AND problem NOT IN
            ('MODEL_UNAVAILABLE','INFERENCE_FAILED','CAPTURE_INVALID','CONSENT_REQUIRED','TIMEOUT')
          THEN RAISE EXCEPTION 'Invalid pose failure' USING ERRCODE='22023'; END IF;
          UPDATE public.server_pose_jobs j SET
            status=CASE WHEN output IS NOT NULL THEN 'needs_review'
              WHEN problem IN ('INFERENCE_FAILED','TIMEOUT') AND attempts<3 THEN 'queued'
              ELSE 'failed' END,
            result=output,error_code=problem,lease_token=NULL,lease_until=NULL,
            run_after=clock_timestamp()+make_interval(secs=>5*power(2,attempts)::integer),
            finished_at=CASE WHEN output IS NOT NULL OR attempts>=3
              OR problem NOT IN ('INFERENCE_FAILED','TIMEOUT') THEN clock_timestamp() END
            WHERE j.id=job AND j.status='processing' AND j.lease_token=token
              AND j.lease_until>clock_timestamp() RETURNING j.id INTO changed;
          RETURN changed IS NOT NULL;
        END $$;

        CREATE FUNCTION public.review_server_pose(
          job uuid,decision text,event_id uuid,correlation uuid
        ) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
          SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE entry public.server_pose_jobs%ROWTYPE; tenant uuid; actor uuid;
        BEGIN
          tenant:=NULLIF(current_setting('app.organization_id',true),'')::uuid;
          actor:=NULLIF(current_setting('app.actor_id',true),'')::uuid;
          SELECT * INTO entry FROM public.server_pose_jobs j WHERE j.id=job
            AND j.organization_id=tenant;
          IF NOT FOUND OR current_setting('app.identity_verified',true) IS DISTINCT FROM 'yes'
            OR decision NOT IN ('accepted','rejected')
            OR NOT public.server_pose_authorized(tenant,entry.profile_id,actor)
          THEN RETURN false; END IF;
          PERFORM 1 FROM public.synthetic_capture_objects c WHERE c.id=entry.capture_id
            AND c.expires_at>clock_timestamp() FOR SHARE OF c;
          IF NOT FOUND THEN RETURN false; END IF;
          UPDATE public.server_pose_jobs j SET status=decision,reviewed_at=clock_timestamp(),
            reviewed_by=actor WHERE j.id=job AND j.status='needs_review'
              AND (decision='rejected' OR j.result->>'detected'='true');
          IF NOT FOUND THEN RETURN false; END IF;
          INSERT INTO public.security_audit_events
            (id,organization_id,actor_id,correlation_id,action,resource_type,resource_id,outcome)
            VALUES(event_id,tenant,actor,correlation,'pose.server.reviewed','profile',
              entry.profile_id,'allowed');
          RETURN true;
        END $$;

        CREATE FUNCTION public.purge_revoked_server_pose() RETURNS trigger
          LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        BEGIN
          IF OLD.status='accepted' AND NEW.status='revoked'
            AND NEW.purpose IN ('pose','capture','storage') THEN
            DELETE FROM public.server_pose_jobs j WHERE j.organization_id=NEW.organization_id
              AND j.profile_id=NEW.profile_id;
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER purge_server_pose_on_revoke AFTER UPDATE OF status ON public.profile_consents
          FOR EACH ROW EXECUTE FUNCTION public.purge_revoked_server_pose();
        REVOKE ALL ON FUNCTION public.purge_revoked_server_pose()
          FROM PUBLIC,bodyvision_app,bodyvision_auth_app,bodyvision_pose_worker;

        REVOKE ALL ON FUNCTION public.enqueue_server_pose(uuid,uuid,uuid,uuid,uuid),
          public.review_server_pose(uuid,text,uuid,uuid) FROM PUBLIC,bodyvision_auth_app;
        GRANT EXECUTE ON FUNCTION public.enqueue_server_pose(uuid,uuid,uuid,uuid,uuid),
          public.review_server_pose(uuid,text,uuid,uuid) TO bodyvision_app;
        REVOKE ALL ON FUNCTION public.claim_server_pose(uuid),public.read_server_pose(uuid,uuid),
          public.finish_server_pose(uuid,uuid,jsonb,text) FROM PUBLIC,bodyvision_app,bodyvision_auth_app;
        GRANT EXECUTE ON FUNCTION public.claim_server_pose(uuid),public.read_server_pose(uuid,uuid),
          public.finish_server_pose(uuid,uuid,jsonb,text) TO bodyvision_pose_worker;
        UPDATE public.system_schema_state SET revision='0033_server_pose_queue';
    """)


def downgrade() -> None:
    op.execute("""
        DROP TRIGGER purge_server_pose_on_revoke ON public.profile_consents;
        DROP FUNCTION public.purge_revoked_server_pose();
        DROP FUNCTION public.review_server_pose(uuid,text,uuid,uuid);
        DROP FUNCTION public.finish_server_pose(uuid,uuid,jsonb,text);
        DROP FUNCTION public.read_server_pose(uuid,uuid);
        DROP FUNCTION public.claim_server_pose(uuid);
        DROP FUNCTION public.enqueue_server_pose(uuid,uuid,uuid,uuid,uuid);
        DROP FUNCTION public.server_pose_authorized(uuid,uuid,uuid);
        DROP TABLE public.server_pose_jobs;
        ALTER TABLE public.synthetic_capture_objects DROP CONSTRAINT pose_capture_scope_key;
        UPDATE public.system_schema_state SET revision='0032_privacy_rejection';
    """)
