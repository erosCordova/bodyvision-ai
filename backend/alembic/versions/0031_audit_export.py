"""Bounded, organization-scoped audit bundle without exposing security tables."""

from alembic import op

revision = "0031_private_audit_export"
down_revision = "0030_private_privacy_officer"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
      CREATE FUNCTION public.export_private_audit_chain(
        digest char(64), export_identifier uuid, correlation uuid
      ) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
      SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE tenant uuid; actor uuid; actor_role text; entry record; entries jsonb;
        chain_index bigint := 0; chain_prior text := repeat('0',64); calculated text;
        expected_position bigint; expected_hash text; failure text := NULL;
        bundle jsonb; snapshot_at timestamptz;
      BEGIN
        SELECT r.org_id,r.actor_id,r.assigned_role INTO tenant,actor,actor_role
          FROM public.resolve_authenticated_session(digest) r;
        IF tenant IS NULL THEN RETURN jsonb_build_object('status','unauthorized'); END IF;
        IF actor_role IS DISTINCT FROM 'administrator'
          THEN RETURN jsonb_build_object('status','forbidden'); END IF;
        IF export_identifier IS NULL OR correlation IS NULL
          OR NOT EXISTS(SELECT 1 FROM public.organizations o WHERE o.id=tenant AND o.synthetic)
          THEN RETURN jsonb_build_object('status','forbidden'); END IF;

        INSERT INTO public.private_audit_heads VALUES(tenant,0,repeat('0',64))
          ON CONFLICT(organization_id) DO NOTHING;
        SELECT last_sequence,last_hash INTO expected_position,expected_hash
          FROM public.private_audit_heads WHERE organization_id=tenant FOR UPDATE;
        snapshot_at := clock_timestamp();
        IF expected_position>10000 THEN failure := 'size-limit'; END IF;
        IF failure IS NULL THEN
          FOR entry IN SELECT * FROM public.security_audit_events
            WHERE organization_id=tenant ORDER BY chain_sequence LIMIT 10001 LOOP
            chain_index := chain_index+1;
            IF chain_index>10000 THEN failure := 'size-limit'; EXIT; END IF;
            calculated := public.private_audit_hash(entry.chain_sequence,chain_prior,
              entry.id,tenant,entry.actor_id,entry.correlation_id,entry.action,
              entry.resource_type,entry.resource_id,entry.outcome,entry.happened_at);
            IF entry.chain_sequence<>chain_index OR entry.previous_hash<>chain_prior
              OR entry.event_hash<>calculated THEN failure := 'invalid-chain'; EXIT; END IF;
            chain_prior := entry.event_hash;
          END LOOP;
          IF failure IS NULL AND
            (chain_index<>expected_position OR chain_prior<>expected_hash)
            THEN failure := 'invalid-chain'; END IF;
        END IF;
        IF failure IS NULL THEN
          -- These are the exact UTF-8 bytes hashed by private_audit_hash,
          -- retained as text so offline verification needs no JSONB serializer.
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'sequence',e.chain_sequence,'previous_hash',e.previous_hash,
            'event_hash',e.event_hash,'payload',jsonb_build_array(
              'bodyvision-audit-v1',e.chain_sequence,e.previous_hash,e.id,tenant,
              e.actor_id,e.correlation_id,e.action,e.resource_type,e.resource_id,
              e.outcome,extract(epoch FROM e.happened_at)::text)::text
            ) ORDER BY e.chain_sequence),'[]'::jsonb) INTO entries
            FROM public.security_audit_events e WHERE e.organization_id=tenant;
          bundle := jsonb_build_object(
            'version',1,'algorithm','sha256-chain-v1',
            'scope','synthetic-organization-audit','organization_id',tenant,
            'export_id',export_identifier,'generated_at',snapshot_at,
            'checkpoint_sequence',expected_position,'checkpoint_hash',expected_hash,
            'external_anchor',false,'events',entries);
          IF octet_length(convert_to(bundle::text,'UTF8'))>8388608
            THEN failure := 'size-limit'; END IF;
        END IF;
        -- The generated file intentionally ends BEFORE this generation event.
        -- No claim is made that a browser saved the bytes on its final disk.
        INSERT INTO public.security_audit_events(
          id,organization_id,actor_id,correlation_id,action,resource_type,resource_id,outcome
        ) VALUES(export_identifier,tenant,actor,correlation,
          CASE WHEN failure IS NULL THEN 'audit.export_generated' ELSE 'audit.export_failed' END,
          'audit',export_identifier,CASE WHEN failure IS NULL THEN 'allowed' ELSE 'error' END);
        IF failure IS NOT NULL THEN RETURN jsonb_build_object('status',failure); END IF;
        RETURN jsonb_build_object('status','ready','bundle',bundle);
      END $$;
      REVOKE ALL ON FUNCTION public.export_private_audit_chain(char(64),uuid,uuid)
        FROM PUBLIC,bodyvision_app;
      GRANT EXECUTE ON FUNCTION public.export_private_audit_chain(char(64),uuid,uuid)
        TO bodyvision_auth_app;
      UPDATE public.system_schema_state SET revision='0031_private_audit_export';
    """)


def downgrade() -> None:
    op.execute("""
      DROP FUNCTION public.export_private_audit_chain(char(64),uuid,uuid);
      UPDATE public.system_schema_state SET revision='0030_private_privacy_officer';
    """)
