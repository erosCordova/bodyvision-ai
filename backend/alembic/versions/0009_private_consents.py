"""Scoped, versioned synthetic consent lifecycle; hosted demo stays on 0002."""

from alembic import op

revision = "0009_private_consents"
down_revision = "0008_profile_permissions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE profile_consents
          DROP CONSTRAINT profile_consents_organization_id_profile_id_purpose_version_key,
          ADD COLUMN cycle integer NOT NULL DEFAULT 1 CHECK(cycle>0),
          ADD COLUMN revoked_by uuid,
          ADD FOREIGN KEY(organization_id,revoked_by) REFERENCES users(organization_id,id),
          ADD UNIQUE(organization_id,profile_id,purpose,version,cycle);
    """)
    op.execute("""
        CREATE FUNCTION private_profile_consents(
          session_digest char(64), profile_uuid uuid, operation text,
          requested_purpose text, target_consent uuid, new_identifier uuid,
          event_identifier uuid, correlation uuid
        ) RETURNS jsonb
        LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE
          tenant uuid;
          actor uuid;
          actor_role text;
          profile_status text;
          grant_level text;
          writer boolean;
          current_consent public.profile_consents%ROWTYPE;
          next_cycle integer;
          event_name text := 'consent.read';
          history jsonb;
        BEGIN
          SELECT r.org_id,r.actor_id,r.assigned_role INTO tenant,actor,actor_role
          FROM resolve_authenticated_session(session_digest) r;
          IF tenant IS NULL THEN RETURN jsonb_build_object('error','not-found'); END IF;
          IF operation IS NULL OR operation NOT IN ('list','accept','revoke')
            THEN RAISE EXCEPTION 'Invalid consent operation' USING ERRCODE='22023';
          END IF;

          -- Serialize lifecycle changes per profile. Hold the grant while the
          -- decision and its audit commit; concurrent revocation waits for us.
          SELECT p.status,a.access_level INTO profile_status,grant_level
          FROM profiles p JOIN organizations o ON o.id=p.organization_id
          JOIN profile_access a ON a.profile_id=p.id AND a.organization_id=p.organization_id
          WHERE p.id=profile_uuid AND p.organization_id=tenant AND o.synthetic
            AND a.user_id=actor AND (a.expires_at IS NULL OR a.expires_at>now())
          FOR UPDATE OF p FOR SHARE OF a;
          IF NOT FOUND THEN RETURN jsonb_build_object('error','not-found'); END IF;
          writer := actor_role IN ('administrator','specialist')
            AND grant_level IN ('write','manage');
          IF operation<>'list' AND NOT writer
            THEN RETURN jsonb_build_object('error','forbidden');
          END IF;

          IF operation='accept' THEN
            IF profile_status<>'active'
              THEN RETURN jsonb_build_object('error','conflict');
            END IF;
            IF requested_purpose IS NULL
              OR requested_purpose NOT IN ('capture','pose','report','storage')
              THEN RAISE EXCEPTION 'Invalid consent purpose' USING ERRCODE='22023';
            END IF;
            SELECT * INTO current_consent FROM profile_consents c
            WHERE c.organization_id=tenant AND c.profile_id=profile_uuid
              AND c.purpose=requested_purpose AND c.version='bv-synthetic-v1'
            ORDER BY c.cycle DESC LIMIT 1;
            IF NOT FOUND OR current_consent.status<>'accepted'
              OR current_consent.accepted_at>now()
              OR current_consent.expires_at IS NULL OR current_consent.expires_at<=now()
            THEN
              SELECT COALESCE(max(c.cycle),0)+1 INTO next_cycle FROM profile_consents c
              WHERE c.organization_id=tenant AND c.profile_id=profile_uuid
                AND c.purpose=requested_purpose AND c.version='bv-synthetic-v1';
              INSERT INTO profile_consents(
                id,organization_id,profile_id,purpose,version,cycle,status,
                accepted_at,expires_at,recorded_by
              ) VALUES (
                new_identifier,tenant,profile_uuid,requested_purpose,'bv-synthetic-v1',
                next_cycle,'accepted',now(),now()+interval '30 days',actor
              );
              event_name := 'consent.accepted';
            END IF;
          ELSIF operation='revoke' THEN
            UPDATE profile_consents c SET status='revoked',revoked_at=now(),revoked_by=actor
            WHERE c.id=target_consent AND c.organization_id=tenant
              AND c.profile_id=profile_uuid AND c.status='accepted';
            IF NOT FOUND THEN RETURN jsonb_build_object('error','conflict'); END IF;
            event_name := 'consent.revoked';
          END IF;

          INSERT INTO security_audit_events(
            id,organization_id,actor_id,correlation_id,action,resource_type,resource_id,outcome
          ) VALUES (
            event_identifier,tenant,actor,correlation,event_name,'profile',profile_uuid,'allowed'
          );
          SELECT COALESCE(jsonb_agg(row_data ORDER BY created_at DESC,id DESC),'[]'::jsonb)
          INTO history FROM (
            SELECT c.created_at,c.id,jsonb_build_object(
              'id',c.id,'purpose',c.purpose,'version',c.version,'cycle',c.cycle,
              'status',c.status,'accepted_at',c.accepted_at,'revoked_at',c.revoked_at,
              'expires_at',c.expires_at,'recorded_by',c.recorded_by,'revoked_by',c.revoked_by,
              'effective',c.version='bv-synthetic-v1' AND c.status='accepted'
                AND c.accepted_at<=now() AND c.revoked_at IS NULL
                AND c.expires_at IS NOT NULL AND c.expires_at>now()
                AND c.cycle=(SELECT max(n.cycle) FROM profile_consents n
                  WHERE n.organization_id=c.organization_id AND n.profile_id=c.profile_id
                    AND n.purpose=c.purpose AND n.version=c.version)
            ) AS row_data FROM profile_consents c
            WHERE c.organization_id=tenant AND c.profile_id=profile_uuid
              AND (c.id IN (SELECT h.id FROM profile_consents h
                WHERE h.organization_id=tenant AND h.profile_id=profile_uuid
                ORDER BY h.created_at DESC,h.id DESC LIMIT 100)
                OR (c.version='bv-synthetic-v1' AND c.cycle=(SELECT max(n.cycle)
                  FROM profile_consents n WHERE n.organization_id=tenant
                    AND n.profile_id=profile_uuid AND n.purpose=c.purpose
                    AND n.version=c.version)))
            ORDER BY c.created_at DESC,c.id DESC
          ) recent;
          RETURN jsonb_build_object(
            'items',history,'can_record',writer AND profile_status='active',
            'can_revoke',writer,'policy_version','bv-synthetic-v1','checked_at',now()
          );
        END $$;
        REVOKE ALL ON FUNCTION private_profile_consents(
          char(64),uuid,text,text,uuid,uuid,uuid,uuid
        ) FROM PUBLIC,bodyvision_app;
        GRANT EXECUTE ON FUNCTION private_profile_consents(
          char(64),uuid,text,text,uuid,uuid,uuid,uuid
        ) TO bodyvision_auth_app;
    """)
    op.execute("UPDATE system_schema_state SET revision='0009_private_consents'")


def downgrade() -> None:
    # Refuse a downgrade that cannot represent renewal history. Never relabel
    # document versions or silently discard an acceptance to fit the old schema.
    op.execute("""
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM profile_consents
            GROUP BY organization_id,profile_id,purpose,version HAVING count(*)>1)
          THEN RAISE EXCEPTION 'Renewal history requires the consent lifecycle schema';
          END IF;
        END $$;
    """)
    op.execute(
        "DROP FUNCTION private_profile_consents(char(64),uuid,text,text,uuid,uuid,uuid,uuid)"
    )
    op.execute("""
        ALTER TABLE profile_consents DROP COLUMN cycle,DROP COLUMN revoked_by;
        ALTER TABLE profile_consents
          ADD UNIQUE(organization_id,profile_id,purpose,version);
    """)
    op.execute("UPDATE system_schema_state SET revision='0008_profile_permissions'")
