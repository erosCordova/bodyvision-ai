"""Synthetic user directory, account lifecycle and permission metadata."""

from alembic import op

revision = "0011_user_management"
down_revision = "0010_admin_password_reset"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE FUNCTION private_admin_users(
          digest char(64), query_text text, page_limit integer, page_offset integer
        ) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE tenant uuid; actor uuid; actor_role text; rows_json jsonb; total_rows integer;
        BEGIN
          SELECT r.org_id,r.actor_id,r.assigned_role INTO tenant,actor,actor_role
            FROM public.resolve_authenticated_session(digest) r;
          IF actor_role IS DISTINCT FROM 'administrator'
            THEN RETURN jsonb_build_object('error','forbidden'); END IF;
          IF page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 OR page_offset<0
            OR page_offset IS NULL OR query_text IS NULL OR length(query_text)>100
            THEN RAISE EXCEPTION 'Invalid pagination' USING ERRCODE='22023'; END IF;
          SELECT count(*) INTO total_rows FROM public.users u
            JOIN public.organizations o ON o.id=u.organization_id
          WHERE u.organization_id=tenant AND o.synthetic AND NOT u.is_local_operator
            AND split_part(u.email,'@',2)='example.invalid'
            AND (u.display_name ILIKE '%'||query_text||'%' OR u.email ILIKE '%'||query_text||'%');
          SELECT COALESCE(jsonb_agg(entry ORDER BY display_name,id),'[]'::jsonb) INTO rows_json
          FROM (
            SELECT u.id,u.display_name,jsonb_build_object(
              'id',u.id,'display_name',u.display_name,'email',u.email,
              'status',u.account_status,'role',COALESCE(r.role,'unassigned'),
              'manageable',COALESCE(u.id<>actor AND u.account_status IN ('active','disabled')
                AND r.role IN ('member','specialist')
                AND NOT EXISTS(SELECT 1 FROM public.user_role_assignments a
                  WHERE a.user_id=u.id AND a.organization_id=tenant
                    AND a.role='administrator'),false)
            ) AS entry FROM public.users u
            JOIN public.organizations o ON o.id=u.organization_id
            LEFT JOIN LATERAL (SELECT a.role FROM public.user_role_assignments a
              WHERE a.user_id=u.id AND a.organization_id=tenant
                AND (a.expires_at IS NULL OR a.expires_at>now())
              ORDER BY CASE a.role WHEN 'administrator' THEN 1
                WHEN 'specialist' THEN 2 ELSE 3 END LIMIT 1) r ON true
            WHERE u.organization_id=tenant AND o.synthetic AND NOT u.is_local_operator
              AND split_part(u.email,'@',2)='example.invalid'
              AND (u.display_name ILIKE '%'||query_text||'%' OR u.email ILIKE '%'||query_text||'%')
            ORDER BY u.display_name,u.id LIMIT page_limit OFFSET page_offset
          ) listed;
          RETURN jsonb_build_object('items',rows_json,'total',total_rows,
            'limit',page_limit,'offset',page_offset);
        END $$;
        REVOKE ALL ON FUNCTION private_admin_users(char(64),text,integer,integer)
          FROM PUBLIC,bodyvision_app;
        GRANT EXECUTE ON FUNCTION private_admin_users(char(64),text,integer,integer)
          TO bodyvision_auth_app;
    """)
    op.execute("""
        CREATE FUNCTION private_permission_catalog(digest char(64), subject uuid, query_text text)
        RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE tenant uuid; actor_role text; records_json jsonb;
        BEGIN
          SELECT r.org_id,r.assigned_role INTO tenant,actor_role
            FROM public.resolve_authenticated_session(digest) r;
          IF actor_role IS DISTINCT FROM 'administrator'
            THEN RETURN jsonb_build_object('error','forbidden'); END IF;
          IF query_text IS NULL OR length(query_text)>100
            THEN RAISE EXCEPTION 'Invalid search' USING ERRCODE='22023'; END IF;
          IF NOT EXISTS(SELECT 1 FROM public.users u JOIN public.organizations o
            ON o.id=u.organization_id WHERE u.id=subject AND u.organization_id=tenant
            AND o.synthetic AND NOT u.is_local_operator
            AND split_part(u.email,'@',2)='example.invalid')
            THEN RETURN jsonb_build_object('error','not-found'); END IF;
          SELECT COALESCE(jsonb_agg(entry ORDER BY display_code,id),'[]'::jsonb) INTO records_json
          FROM (SELECT p.id,p.display_code,jsonb_build_object(
              'id',p.id,'display_code',p.display_code,'status',p.status,
              'access_level',a.access_level,'expires_at',a.expires_at,
              'effective',a.id IS NOT NULL AND (a.expires_at IS NULL OR a.expires_at>now())
            ) AS entry FROM public.profiles p
            LEFT JOIN public.profile_access a ON a.organization_id=p.organization_id
              AND a.profile_id=p.id AND a.user_id=subject
            WHERE p.organization_id=tenant AND p.display_code ILIKE '%'||query_text||'%'
            ORDER BY p.display_code,p.id LIMIT 100) choices;
          RETURN jsonb_build_object('items',records_json);
        END $$;
        REVOKE ALL ON FUNCTION private_permission_catalog(char(64),uuid,text)
          FROM PUBLIC,bodyvision_app;
        GRANT EXECUTE ON FUNCTION private_permission_catalog(char(64),uuid,text)
          TO bodyvision_auth_app;
    """)
    op.execute("""
        CREATE FUNCTION set_synthetic_account_status(
          digest char(64), subject uuid, requested_status text, administrator_verifier text,
          event_identifier uuid, correlation uuid
        ) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE tenant uuid; actor uuid; actor_role text; verifier text; email_value text;
          previous_status text; result_status text := 'forbidden'; affected integer := 0;
        BEGIN
          SELECT r.org_id,r.actor_id,r.assigned_role INTO tenant,actor,actor_role
            FROM public.resolve_authenticated_session(digest) r;
          IF tenant IS NULL THEN RETURN jsonb_build_object('status','unauthorized'); END IF;
          IF requested_status IS NULL OR requested_status NOT IN ('active','disabled')
            THEN RAISE EXCEPTION 'Invalid account state' USING ERRCODE='22023'; END IF;
          IF actor_role='administrator' THEN
            SELECT u.password_hash INTO verifier FROM public.users u
              JOIN public.organizations o ON o.id=u.organization_id
            WHERE u.id=actor AND u.organization_id=tenant AND o.synthetic
              AND u.account_status='active' AND NOT u.is_local_operator FOR UPDATE OF u;
            IF verifier IS NULL OR administrator_verifier IS NULL
              OR verifier<>administrator_verifier THEN result_status := 'reauthentication-failed';
            ELSE
              SELECT u.account_status,u.email INTO previous_status,email_value
              FROM public.users u WHERE u.id=subject AND u.organization_id=tenant AND u.id<>actor
                AND NOT u.is_local_operator AND u.account_status IN ('active','disabled')
                AND split_part(u.email,'@',2)='example.invalid'
                AND EXISTS(SELECT 1 FROM public.user_role_assignments a WHERE a.user_id=subject
                  AND a.organization_id=tenant AND a.role IN ('member','specialist')
                  AND (a.expires_at IS NULL OR a.expires_at>now()))
                AND NOT EXISTS(SELECT 1 FROM public.user_role_assignments a
                  WHERE a.user_id=subject AND a.organization_id=tenant AND a.role='administrator')
              FOR UPDATE OF u;
              IF NOT FOUND THEN result_status := 'not-found';
              ELSIF previous_status=requested_status THEN result_status := 'unchanged';
              ELSE
                UPDATE public.users SET account_status=requested_status
                  WHERE id=subject AND organization_id=tenant;
                IF requested_status='disabled' THEN
                  UPDATE public.auth_sessions SET revoked_at=clock_timestamp()
                    WHERE user_id=subject AND organization_id=tenant AND revoked_at IS NULL;
                  GET DIAGNOSTICS affected=ROW_COUNT;
                END IF;
                result_status := 'changed';
              END IF;
            END IF;
          END IF;
          INSERT INTO public.security_audit_events(
            id,organization_id,actor_id,correlation_id,action,resource_type,resource_id,outcome
          ) VALUES(event_identifier,tenant,actor,correlation,
            CASE WHEN result_status='changed' THEN
              CASE WHEN requested_status='disabled' THEN 'admin.account_disabled'
                ELSE 'admin.account_enabled' END
              WHEN result_status='unchanged' THEN 'admin.account_status_unchanged'
              ELSE 'admin.account_status_denied' END,
            'user',CASE WHEN result_status IN ('changed','unchanged') THEN subject ELSE NULL END,
            CASE WHEN result_status IN ('changed','unchanged') THEN 'allowed' ELSE 'denied' END);
          RETURN jsonb_build_object('status',result_status,'revoked_sessions',affected,
            'login_email',CASE WHEN result_status IN ('changed','unchanged')
              THEN email_value ELSE NULL END);
        END $$;
        REVOKE ALL ON FUNCTION set_synthetic_account_status(char(64),uuid,text,text,uuid,uuid)
          FROM PUBLIC,bodyvision_app;
        GRANT EXECUTE ON FUNCTION set_synthetic_account_status(char(64),uuid,text,text,uuid,uuid)
          TO bodyvision_auth_app;
    """)
    op.execute("""
        CREATE FUNCTION private_admin_audit(digest char(64), row_limit integer)
        RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE tenant uuid; actor_role text; result_rows jsonb;
        BEGIN
          SELECT r.org_id,r.assigned_role INTO tenant,actor_role
            FROM public.resolve_authenticated_session(digest) r;
          IF actor_role IS DISTINCT FROM 'administrator'
            THEN RETURN jsonb_build_object('error','forbidden'); END IF;
          IF row_limit IS NULL OR row_limit NOT BETWEEN 1 AND 50
            THEN RAISE EXCEPTION 'Invalid audit limit' USING ERRCODE='22023'; END IF;
          SELECT COALESCE(jsonb_agg(to_jsonb(recent)
            ORDER BY happened_at DESC,id DESC),'[]'::jsonb) INTO result_rows
          FROM (SELECT e.id,e.actor_id,e.action,e.resource_type,e.resource_id,
              e.outcome,e.happened_at,actor.email AS actor_label,
              COALESCE(subject.email,p.display_code) AS target_label
            FROM public.security_audit_events e
            LEFT JOIN public.users actor ON actor.id=e.actor_id AND actor.organization_id=tenant
            LEFT JOIN public.users subject ON subject.id=e.resource_id
              AND e.resource_type='user' AND subject.organization_id=tenant
            LEFT JOIN public.profiles p ON p.id=e.resource_id
              AND e.resource_type='profile' AND p.organization_id=tenant
            WHERE e.organization_id=tenant
            ORDER BY e.happened_at DESC,e.id DESC LIMIT row_limit) recent;
          RETURN result_rows;
        END $$;
        REVOKE ALL ON FUNCTION private_admin_audit(char(64),integer) FROM PUBLIC,bodyvision_app;
        GRANT EXECUTE ON FUNCTION private_admin_audit(char(64),integer) TO bodyvision_auth_app;
    """)
    op.execute("UPDATE system_schema_state SET revision='0011_user_management'")


def downgrade() -> None:
    op.execute("DROP FUNCTION private_admin_audit(char(64),integer)")
    op.execute("DROP FUNCTION set_synthetic_account_status(char(64),uuid,text,text,uuid,uuid)")
    op.execute("DROP FUNCTION private_permission_catalog(char(64),uuid,text)")
    op.execute("DROP FUNCTION private_admin_users(char(64),text,integer,integer)")
    op.execute("UPDATE system_schema_state SET revision='0010_admin_password_reset'")
