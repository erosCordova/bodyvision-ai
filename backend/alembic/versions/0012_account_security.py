"""Self-service credentials and sessions, with a verifiable tenant audit chain."""

from alembic import op

revision = "0012_account_security"
down_revision = "0011_user_management"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE public.security_audit_events
          ADD COLUMN chain_sequence bigint,
          ADD COLUMN previous_hash char(64),
          ADD COLUMN event_hash char(64);
        CREATE TABLE public.private_audit_heads (
          organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
          last_sequence bigint NOT NULL CHECK(last_sequence>=0),
          last_hash char(64) NOT NULL CHECK(last_hash ~ '^[0-9a-f]{64}$')
        );
        ALTER TABLE public.private_audit_heads ENABLE ROW LEVEL SECURITY;
        REVOKE ALL ON public.private_audit_heads FROM PUBLIC,bodyvision_app,bodyvision_auth_app;

        CREATE FUNCTION public.private_audit_hash(
          chain_index bigint, chain_prior text, identifier uuid, tenant uuid, actor uuid,
          correlation uuid, operation text, resource text, target uuid,
          result text, event_time timestamptz
        ) RETURNS text LANGUAGE sql IMMUTABLE
        SET search_path=pg_catalog,public,pg_temp AS $$
          SELECT encode(sha256(convert_to(jsonb_build_array(
            'bodyvision-audit-v1',chain_index,chain_prior,identifier,tenant,actor,correlation,
            operation,resource,target,result,extract(epoch FROM event_time)::text
          )::text,'UTF8')),'hex')
        $$;
        REVOKE ALL ON FUNCTION public.private_audit_hash(
          bigint,text,uuid,uuid,uuid,uuid,text,text,uuid,text,timestamptz
        ) FROM PUBLIC,bodyvision_app,bodyvision_auth_app;

        -- Backfill only establishes a baseline; it cannot prove the integrity
        -- of events recorded before this migration.
        DO $$
        DECLARE entry record; tenant uuid; chain_index bigint; chain_prior text; digest text;
        BEGIN
          FOR tenant IN SELECT DISTINCT organization_id FROM public.security_audit_events LOOP
            chain_index := 0; chain_prior := repeat('0',64);
            FOR entry IN SELECT * FROM public.security_audit_events
              WHERE organization_id=tenant ORDER BY happened_at,id LOOP
              chain_index := chain_index+1;
              digest := public.private_audit_hash(chain_index,chain_prior,entry.id,tenant,
                entry.actor_id,entry.correlation_id,entry.action,entry.resource_type,
                entry.resource_id,entry.outcome,entry.happened_at);
              UPDATE public.security_audit_events SET chain_sequence=chain_index,
                previous_hash=chain_prior,event_hash=digest WHERE id=entry.id;
              chain_prior := digest;
            END LOOP;
            INSERT INTO public.private_audit_heads VALUES(tenant,chain_index,chain_prior);
          END LOOP;
        END $$;
        ALTER TABLE public.security_audit_events
          ALTER COLUMN chain_sequence SET NOT NULL,
          ALTER COLUMN previous_hash SET NOT NULL,
          ALTER COLUMN event_hash SET NOT NULL,
          ADD CONSTRAINT audit_chain_position CHECK(chain_sequence>0),
          ADD CONSTRAINT audit_chain_previous CHECK(previous_hash ~ '^[0-9a-f]{64}$'),
          ADD CONSTRAINT audit_chain_digest CHECK(event_hash ~ '^[0-9a-f]{64}$'),
          ADD CONSTRAINT audit_chain_unique UNIQUE(organization_id,chain_sequence);

        CREATE FUNCTION public.append_private_audit_chain() RETURNS trigger
        LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE chain_index bigint; chain_prior text;
        BEGIN
          INSERT INTO public.private_audit_heads VALUES(NEW.organization_id,0,repeat('0',64))
            ON CONFLICT(organization_id) DO NOTHING;
          SELECT last_sequence,last_hash INTO chain_index,chain_prior FROM public.private_audit_heads
            WHERE organization_id=NEW.organization_id FOR UPDATE;
          NEW.chain_sequence := chain_index+1;
          NEW.previous_hash := chain_prior;
          NEW.event_hash := public.private_audit_hash(NEW.chain_sequence,chain_prior,
            NEW.id,NEW.organization_id,NEW.actor_id,NEW.correlation_id,NEW.action,
            NEW.resource_type,NEW.resource_id,NEW.outcome,NEW.happened_at);
          UPDATE public.private_audit_heads SET last_sequence=NEW.chain_sequence,
            last_hash=NEW.event_hash WHERE organization_id=NEW.organization_id;
          RETURN NEW;
        END $$;
        REVOKE ALL ON FUNCTION public.append_private_audit_chain()
          FROM PUBLIC,bodyvision_app,bodyvision_auth_app;
        CREATE TRIGGER append_audit_chain BEFORE INSERT ON public.security_audit_events
          FOR EACH ROW EXECUTE FUNCTION public.append_private_audit_chain();
    """)
    op.execute("""
        CREATE FUNCTION public.private_own_sessions(
          digest char(64), page_limit integer, page_offset integer
        ) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE tenant uuid; actor uuid; entries jsonb; total bigint;
        BEGIN
          SELECT r.org_id,r.actor_id INTO tenant,actor
            FROM public.resolve_authenticated_session(digest) r;
          IF tenant IS NULL THEN RETURN jsonb_build_object('status','unauthorized'); END IF;
          IF page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50
            OR page_offset IS NULL OR page_offset<0
            THEN RAISE EXCEPTION 'Invalid pagination' USING ERRCODE='22023'; END IF;
          SELECT count(*) INTO total FROM public.auth_sessions s
            WHERE s.organization_id=tenant AND s.user_id=actor
              AND s.revoked_at IS NULL AND s.expires_at>now();
          SELECT COALESCE(jsonb_agg(entry ORDER BY is_current DESC,issued_at DESC,id),'[]')
            INTO entries FROM (
              SELECT s.id,s.issued_at,(s.token_sha256=digest) AS is_current,
                jsonb_build_object('id',s.id,'issued_at',s.issued_at,
                  'expires_at',s.expires_at,'current',s.token_sha256=digest) AS entry
              FROM public.auth_sessions s WHERE s.organization_id=tenant AND s.user_id=actor
                AND s.revoked_at IS NULL AND s.expires_at>now()
              ORDER BY (s.token_sha256=digest) DESC,s.issued_at DESC,s.id
              LIMIT page_limit OFFSET page_offset
            ) page;
          RETURN jsonb_build_object('items',entries,'total',total,
            'limit',page_limit,'offset',page_offset,'checked_at',now());
        END $$;

        CREATE FUNCTION public.private_own_security_change(
          digest char(64), operation text, subject_session uuid, expected_verifier text,
          new_verifier text, event_identifier uuid, correlation uuid
        ) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE tenant uuid; actor uuid; stored_verifier text; affected integer := 0;
          result_status text := 'reauthentication-failed'; current_revoked boolean := false;
        BEGIN
          IF operation IS NULL OR operation NOT IN ('password','session','all-sessions')
            THEN RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023'; END IF;
          SELECT r.org_id,r.actor_id INTO tenant,actor
            FROM public.resolve_authenticated_session(digest) r;
          IF tenant IS NULL THEN RETURN jsonb_build_object('status','unauthorized'); END IF;
          -- Uses the same user lock as password reset, login issuance and
          -- suspension. Recheck the bearer after waiting for that lock.
          SELECT u.password_hash INTO stored_verifier FROM public.users u
            JOIN public.organizations o ON o.id=u.organization_id
            WHERE u.id=actor AND u.organization_id=tenant AND o.synthetic
              AND u.account_status='active' AND NOT u.is_local_operator
              AND split_part(u.email,'@',2)='example.invalid' FOR UPDATE OF u;
          IF NOT FOUND OR NOT EXISTS(
            SELECT 1 FROM public.resolve_authenticated_session(digest)
          ) THEN RETURN jsonb_build_object('status','unauthorized'); END IF;
          IF expected_verifier IS NOT NULL AND stored_verifier=expected_verifier THEN
            IF operation='password' THEN
              IF new_verifier IS NULL OR new_verifier !~
                '^pbkdf2_sha256[$]600000[$][0-9a-f]{32}[$][0-9a-f]{64}$'
                THEN RAISE EXCEPTION 'Invalid verifier' USING ERRCODE='22023'; END IF;
              UPDATE public.users SET password_hash=new_verifier
                WHERE id=actor AND organization_id=tenant;
              UPDATE public.auth_sessions SET revoked_at=clock_timestamp()
                WHERE organization_id=tenant AND user_id=actor AND revoked_at IS NULL
                  AND expires_at>now();
              GET DIAGNOSTICS affected=ROW_COUNT;
              current_revoked := true; result_status := 'changed';
            ELSIF operation='all-sessions' THEN
              UPDATE public.auth_sessions SET revoked_at=clock_timestamp()
                WHERE organization_id=tenant AND user_id=actor AND revoked_at IS NULL
                  AND expires_at>now();
              GET DIAGNOSTICS affected=ROW_COUNT;
              current_revoked := true; result_status := 'revoked';
            ELSE
              UPDATE public.auth_sessions SET revoked_at=clock_timestamp()
                WHERE organization_id=tenant AND user_id=actor AND id=subject_session
                  AND revoked_at IS NULL AND expires_at>now()
                RETURNING token_sha256=digest INTO current_revoked;
              GET DIAGNOSTICS affected=ROW_COUNT;
              result_status := CASE WHEN affected=1 THEN 'revoked' ELSE 'not-found' END;
            END IF;
          END IF;
          INSERT INTO public.security_audit_events(
            id,organization_id,actor_id,correlation_id,action,resource_type,resource_id,outcome
          ) VALUES(event_identifier,tenant,actor,correlation,
            CASE WHEN operation='password' THEN 'account.password_change'
              ELSE 'account.session_revoke' END ||
              CASE WHEN result_status IN ('changed','revoked') THEN '' ELSE '_denied' END,
            'user',actor,CASE WHEN result_status IN ('changed','revoked')
              THEN 'allowed' ELSE 'denied' END);
          RETURN jsonb_build_object('status',result_status,'revoked_sessions',affected,
            'current_revoked',COALESCE(current_revoked,false));
        END $$;

        CREATE FUNCTION public.verify_private_audit_chain(
          digest char(64), event_identifier uuid, correlation uuid
        ) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE tenant uuid; actor uuid; actor_role text; entry record;
          chain_index bigint := 0; chain_prior text := repeat('0',64); calculated text;
          expected_position bigint; expected_hash text; invalid_position bigint := NULL;
          result jsonb;
        BEGIN
          SELECT r.org_id,r.actor_id,r.assigned_role INTO tenant,actor,actor_role
            FROM public.resolve_authenticated_session(digest) r;
          IF tenant IS NULL THEN RETURN jsonb_build_object('status','unauthorized'); END IF;
          IF actor_role<>'administrator' THEN
            RETURN jsonb_build_object('status','forbidden'); END IF;
          -- Lock the head so appends cannot change the checkpoint during the
          -- verification. No application role can edit either table directly.
          INSERT INTO public.private_audit_heads VALUES(tenant,0,repeat('0',64))
            ON CONFLICT(organization_id) DO NOTHING;
          SELECT last_sequence,last_hash INTO expected_position,expected_hash
            FROM public.private_audit_heads WHERE organization_id=tenant FOR UPDATE;
          FOR entry IN SELECT * FROM public.security_audit_events
            WHERE organization_id=tenant ORDER BY chain_sequence LOOP
            chain_index := chain_index+1;
            calculated := public.private_audit_hash(entry.chain_sequence,chain_prior,
              entry.id,tenant,entry.actor_id,entry.correlation_id,entry.action,
              entry.resource_type,entry.resource_id,entry.outcome,entry.happened_at);
            IF entry.chain_sequence<>chain_index OR entry.previous_hash<>chain_prior
              OR entry.event_hash<>calculated THEN
              invalid_position := chain_index; EXIT;
            END IF;
            chain_prior := entry.event_hash;
          END LOOP;
          IF invalid_position IS NULL AND
            (chain_index<>expected_position OR chain_prior<>expected_hash)
            THEN invalid_position := chain_index+1; END IF;
          result := jsonb_build_object('valid',invalid_position IS NULL,
            'checked_events',chain_index,'checkpoint_sequence',expected_position,
            'checkpoint_hash',expected_hash,'first_invalid_sequence',invalid_position,
            'checked_at',clock_timestamp(),'algorithm','sha256-chain-v1');
          INSERT INTO public.security_audit_events(
            id,organization_id,actor_id,correlation_id,action,resource_type,outcome
          ) VALUES(event_identifier,tenant,actor,correlation,'audit.integrity_check','audit',
            CASE WHEN invalid_position IS NULL THEN 'allowed' ELSE 'error' END);
          RETURN result;
        END $$;
    """)
    for signature in (
        "private_own_sessions(char(64),integer,integer)",
        "private_own_security_change(char(64),text,uuid,text,text,uuid,uuid)",
        "verify_private_audit_chain(char(64),uuid,uuid)",
    ):
        op.execute(f"REVOKE ALL ON FUNCTION public.{signature} FROM PUBLIC,bodyvision_app")
        op.execute(f"GRANT EXECUTE ON FUNCTION public.{signature} TO bodyvision_auth_app")
    op.execute("UPDATE system_schema_state SET revision='0012_account_security'")


def downgrade() -> None:
    for signature in (
        "private_own_sessions(char(64),integer,integer)",
        "private_own_security_change(char(64),text,uuid,text,text,uuid,uuid)",
        "verify_private_audit_chain(char(64),uuid,uuid)",
    ):
        op.execute(f"DROP FUNCTION public.{signature}")
    op.execute("DROP TRIGGER append_audit_chain ON public.security_audit_events")
    op.execute("DROP FUNCTION public.append_private_audit_chain()")
    op.execute("""DROP FUNCTION public.private_audit_hash(
        bigint,text,uuid,uuid,uuid,uuid,text,text,uuid,text,timestamptz)""")
    op.execute("DROP TABLE public.private_audit_heads")
    op.execute("""ALTER TABLE public.security_audit_events
        DROP COLUMN chain_sequence,DROP COLUMN previous_hash,DROP COLUMN event_hash""")
    op.execute("UPDATE system_schema_state SET revision='0011_user_management'")
