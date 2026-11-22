"""One-time synthetic user invitations and tenant-isolated acceptance.

Only test/local identities may issue invitations. The raw invitation secret
is never written to PostgreSQL; only its SHA-256 digest is retained.
"""

from alembic import op

revision = "0025_synthetic_invitations"
down_revision = "0024_atomic_session_rotation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE public.synthetic_user_invitations (
          id uuid PRIMARY KEY,
          organization_id uuid NOT NULL REFERENCES public.organizations(id),
          invited_email varchar(254) NOT NULL,
          display_name varchar(100) NOT NULL,
          invited_role varchar(20) NOT NULL
            CHECK (invited_role IN ('specialist','member')),
          token_sha256 char(64) NOT NULL UNIQUE
            CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
          created_by uuid NOT NULL,
          created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
          expires_at timestamptz NOT NULL,
          accepted_at timestamptz,
          accepted_by uuid,
          revoked_at timestamptz,
          FOREIGN KEY (organization_id,created_by)
            REFERENCES public.users(organization_id,id),
          FOREIGN KEY (organization_id,accepted_by)
            REFERENCES public.users(organization_id,id),
          CHECK (expires_at > created_at),
          CHECK (accepted_at IS NULL OR revoked_at IS NULL),
          CHECK ((accepted_at IS NULL) = (accepted_by IS NULL)),
          CHECK (invited_email = lower(invited_email)),
          CHECK (invited_email ~ '^[a-z0-9._%+-]+@example[.]invalid$'),
          CHECK (length(btrim(display_name)) BETWEEN 3 AND 100)
        );
        CREATE UNIQUE INDEX synthetic_pending_invitation_by_email
          ON public.synthetic_user_invitations
          (organization_id,lower(invited_email))
          WHERE accepted_at IS NULL AND revoked_at IS NULL;
        CREATE INDEX synthetic_invitation_tenant_time
          ON public.synthetic_user_invitations
          (organization_id,created_at DESC);
        ALTER TABLE public.synthetic_user_invitations ENABLE ROW LEVEL SECURITY;
        REVOKE ALL ON TABLE public.synthetic_user_invitations
          FROM PUBLIC,bodyvision_app,bodyvision_auth_app;
    """)
    op.execute("""
        CREATE FUNCTION public.private_create_synthetic_invitation(
          session_digest char(64), invite_id uuid, invite_digest char(64),
          email_value text, name_value text, role_value text,
          expected_verifier text, audit_id uuid, correlation uuid
        ) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE tenant uuid; actor uuid; effective_role text;
          current_verifier text; normalized_email text; expiry timestamptz;
        BEGIN
          SELECT r.org_id,r.actor_id,r.assigned_role
            INTO tenant,actor,effective_role
            FROM public.resolve_authenticated_session(session_digest) r;
          IF tenant IS NULL THEN RETURN jsonb_build_object('status','unauthorized'); END IF;
          IF effective_role IS DISTINCT FROM 'administrator' THEN
            RETURN jsonb_build_object('status','forbidden');
          END IF;
          IF invite_id IS NULL OR invite_digest IS NULL
             OR invite_digest !~ '^[0-9a-f]{64}$'
             OR email_value IS NULL OR name_value IS NULL
             OR role_value IS NULL OR expected_verifier IS NULL
             OR audit_id IS NULL OR correlation IS NULL THEN
            RETURN jsonb_build_object('status','invalid');
          END IF;
          normalized_email := lower(btrim(email_value));
          IF length(normalized_email)>254
             OR normalized_email !~ '^[a-z0-9._%+-]+@example[.]invalid$'
             OR length(btrim(name_value)) NOT BETWEEN 3 AND 100
             OR length(name_value)>100
             OR role_value NOT IN ('member','specialist') THEN
            RETURN jsonb_build_object('status','invalid');
          END IF;
          -- Serialize invitation creation with password resets and account changes.
          SELECT u.password_hash INTO current_verifier
            FROM public.users u JOIN public.organizations o
              ON o.id=u.organization_id
            WHERE u.organization_id=tenant AND u.id=actor
              AND o.synthetic AND u.account_status='active'
              AND NOT u.is_local_operator
            FOR UPDATE OF u;
          IF current_verifier IS NULL OR current_verifier<>expected_verifier
             OR NOT EXISTS (
               SELECT 1 FROM public.resolve_authenticated_session(session_digest) r
               WHERE r.assigned_role='administrator'
             ) THEN
            RETURN jsonb_build_object('status','reauthentication-failed');
          END IF;
          -- Same invitee may be targeted by different admins concurrently.
          PERFORM pg_advisory_xact_lock(
            hashtextextended(tenant::text || ':' || normalized_email, 0)
          );
          UPDATE public.synthetic_user_invitations
            SET revoked_at=clock_timestamp()
            WHERE organization_id=tenant AND invited_email=normalized_email
              AND accepted_at IS NULL AND revoked_at IS NULL
              AND expires_at<=clock_timestamp();
          IF EXISTS(
            SELECT 1 FROM public.users u
            WHERE u.organization_id=tenant AND lower(u.email)=normalized_email
          ) OR EXISTS(
            SELECT 1 FROM public.synthetic_user_invitations i
            WHERE i.organization_id=tenant AND i.invited_email=normalized_email
              AND i.accepted_at IS NULL AND i.revoked_at IS NULL
          ) THEN
            RETURN jsonb_build_object('status','already-exists');
          END IF;
          expiry := clock_timestamp()+interval '48 hours';
          INSERT INTO public.synthetic_user_invitations(
            id,organization_id,invited_email,display_name,invited_role,
            token_sha256,created_by,expires_at
          ) VALUES(
            invite_id,tenant,normalized_email,btrim(name_value),role_value,
            invite_digest,actor,expiry
          );
          INSERT INTO public.security_audit_events(
            id,organization_id,actor_id,correlation_id,
            action,resource_type,resource_id,outcome
          ) VALUES(
            audit_id,tenant,actor,correlation,
            'admin.invitation_created','invitation',invite_id,'allowed'
          );
          RETURN jsonb_build_object('status','created','expires_at',expiry);
        END $$;
        REVOKE ALL ON FUNCTION public.private_create_synthetic_invitation(
          char(64),uuid,char(64),text,text,text,text,uuid,uuid
        ) FROM PUBLIC,bodyvision_app;
        GRANT EXECUTE ON FUNCTION public.private_create_synthetic_invitation(
          char(64),uuid,char(64),text,text,text,text,uuid,uuid
        ) TO bodyvision_auth_app;
    """)
    op.execute("""
        CREATE FUNCTION public.private_synthetic_invitation_ready(invite_digest char(64))
        RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
          SELECT EXISTS(
            SELECT 1 FROM public.synthetic_user_invitations i
            JOIN public.organizations o ON o.id=i.organization_id
            JOIN public.users u ON u.id=i.created_by
              AND u.organization_id=i.organization_id
            WHERE i.token_sha256=invite_digest
              AND i.accepted_at IS NULL AND i.revoked_at IS NULL
              AND i.expires_at>now() AND o.synthetic
              AND u.account_status='active'
              AND EXISTS (
                SELECT 1 FROM public.user_role_assignments r
                WHERE r.organization_id=i.organization_id
                  AND r.user_id=i.created_by AND r.role='administrator'
                  AND (r.expires_at IS NULL OR r.expires_at>now())
              )
          )
        $$;
        REVOKE ALL ON FUNCTION
          public.private_synthetic_invitation_ready(char(64))
          FROM PUBLIC,bodyvision_app;
        GRANT EXECUTE ON FUNCTION
          public.private_synthetic_invitation_ready(char(64))
          TO bodyvision_auth_app;
    """)
    op.execute("""
        CREATE FUNCTION public.private_accept_synthetic_invitation(
          invite_digest char(64), new_user_id uuid, new_role_id uuid,
          password_verifier text, audit_id uuid, correlation uuid
        ) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE invitation_record public.synthetic_user_invitations%ROWTYPE;
        BEGIN
          IF new_user_id IS NULL OR new_role_id IS NULL
             OR password_verifier IS NULL OR password_verifier !~
               '^[$]argon2id[$]v=19[$]m=65536,t=3,p=4[$][A-Za-z0-9+/]{22}[$][A-Za-z0-9+/]{43}$'
             OR audit_id IS NULL OR correlation IS NULL THEN
            RETURN jsonb_build_object('status','invalid');
          END IF;
          -- Lock the exact invitation. A reused or concurrent token fails.
          SELECT * INTO invitation_record
            FROM public.synthetic_user_invitations
            WHERE token_sha256=invite_digest FOR UPDATE;
          IF NOT FOUND OR invitation_record.accepted_at IS NOT NULL
             OR invitation_record.revoked_at IS NOT NULL
             OR invitation_record.expires_at<=clock_timestamp()
             OR NOT public.private_synthetic_invitation_ready(invite_digest)
          THEN RETURN jsonb_build_object('status','invalid'); END IF;
          IF EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.organization_id=invitation_record.organization_id
              AND lower(u.email)=invitation_record.invited_email
          ) THEN RETURN jsonb_build_object('status','invalid'); END IF;
          INSERT INTO public.users(
            id,organization_id,display_name,email,
            password_hash,is_local_operator,account_status
          ) VALUES(
            new_user_id,invitation_record.organization_id,
            invitation_record.display_name,invitation_record.invited_email,
            password_verifier,false,'active'
          );
          INSERT INTO public.user_role_assignments(
            id,organization_id,user_id,role,granted_by
          ) VALUES(
            new_role_id,invitation_record.organization_id,new_user_id,
            invitation_record.invited_role,invitation_record.created_by
          );
          UPDATE public.synthetic_user_invitations
            SET accepted_at=clock_timestamp(),accepted_by=new_user_id
            WHERE id=invitation_record.id;
          INSERT INTO public.security_audit_events(
            id,organization_id,actor_id,correlation_id,
            action,resource_type,resource_id,outcome
          ) VALUES(
            audit_id,invitation_record.organization_id,new_user_id,correlation,
            'auth.invitation_accepted','user',new_user_id,'allowed'
          );
          RETURN jsonb_build_object(
            'status','accepted','user_id',new_user_id,
            'organization_id',invitation_record.organization_id,
            'role',invitation_record.invited_role
          );
        END $$;
        REVOKE ALL ON FUNCTION public.private_accept_synthetic_invitation(
          char(64),uuid,uuid,text,uuid,uuid
        ) FROM PUBLIC,bodyvision_app;
        GRANT EXECUTE ON FUNCTION public.private_accept_synthetic_invitation(
          char(64),uuid,uuid,text,uuid,uuid
        ) TO bodyvision_auth_app;
    """)
    op.execute("""
        CREATE FUNCTION public.private_revoke_synthetic_invitation(
          session_digest char(64), invite_id uuid, audit_id uuid, correlation uuid
        ) RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE tenant uuid; actor uuid; effective_role text; locked_actor uuid;
        BEGIN
          SELECT r.org_id,r.actor_id,r.assigned_role
            INTO tenant,actor,effective_role
            FROM public.resolve_authenticated_session(session_digest) r;
          IF tenant IS NULL THEN RETURN 'unauthorized'; END IF;
          IF effective_role IS DISTINCT FROM 'administrator' THEN RETURN 'forbidden'; END IF;
          SELECT u.id INTO locked_actor FROM public.users u
            WHERE u.organization_id=tenant AND u.id=actor
              AND u.account_status='active' FOR UPDATE;
          IF locked_actor IS NULL OR NOT EXISTS(
            SELECT 1 FROM public.resolve_authenticated_session(session_digest) r
            WHERE r.assigned_role='administrator'
          ) THEN RETURN 'unauthorized'; END IF;
          UPDATE public.synthetic_user_invitations SET revoked_at=clock_timestamp()
            WHERE id=invite_id AND organization_id=tenant
              AND revoked_at IS NULL AND accepted_at IS NULL;
          IF NOT FOUND THEN RETURN 'not-found'; END IF;
          INSERT INTO public.security_audit_events(
            id,organization_id,actor_id,correlation_id,
            action,resource_type,resource_id,outcome
          ) VALUES(
            audit_id,tenant,actor,correlation,
            'admin.invitation_revoked','invitation',invite_id,'allowed'
          );
          RETURN 'revoked';
        END $$;
        REVOKE ALL ON FUNCTION public.private_revoke_synthetic_invitation(
          char(64),uuid,uuid,uuid
        ) FROM PUBLIC,bodyvision_app;
        GRANT EXECUTE ON FUNCTION public.private_revoke_synthetic_invitation(
          char(64),uuid,uuid,uuid
        ) TO bodyvision_auth_app;
    """)
    op.execute("""
        CREATE FUNCTION public.private_list_synthetic_invitations(
          session_digest char(64), page_limit integer, page_offset integer
        ) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE tenant uuid; effective_role text; total_rows bigint; rows_json jsonb;
        BEGIN
          SELECT r.org_id,r.assigned_role INTO tenant,effective_role
            FROM public.resolve_authenticated_session(session_digest) r;
          IF tenant IS NULL THEN RETURN jsonb_build_object('status','unauthorized'); END IF;
          IF effective_role IS DISTINCT FROM 'administrator' THEN
            RETURN jsonb_build_object('status','forbidden'); END IF;
          IF page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50
             OR page_offset IS NULL OR page_offset<0
          THEN RAISE EXCEPTION 'Invalid paging' USING ERRCODE='22023'; END IF;
          SELECT count(*) INTO total_rows FROM public.synthetic_user_invitations
            WHERE organization_id=tenant;
          SELECT COALESCE(jsonb_agg(entry ORDER BY created_at DESC,id),'[]'::jsonb)
            INTO rows_json FROM (
              SELECT i.id,i.created_at,jsonb_build_object(
                'id',i.id,'email',i.invited_email,'display_name',i.display_name,
                'role',i.invited_role,'created_at',i.created_at,'expires_at',i.expires_at,
                'status',CASE WHEN i.accepted_at IS NOT NULL THEN 'accepted'
                  WHEN i.revoked_at IS NOT NULL THEN 'revoked'
                  WHEN i.expires_at<=now() THEN 'expired'
                  ELSE 'pending' END
              ) entry FROM public.synthetic_user_invitations i
              WHERE i.organization_id=tenant
              ORDER BY i.created_at DESC,i.id
              LIMIT page_limit OFFSET page_offset
            ) page;
          RETURN jsonb_build_object(
            'status','ok','items',rows_json,'total',total_rows,
            'limit',page_limit,'offset',page_offset
          );
        END $$;
        REVOKE ALL ON FUNCTION public.private_list_synthetic_invitations(
          char(64),integer,integer
        ) FROM PUBLIC,bodyvision_app;
        GRANT EXECUTE ON FUNCTION public.private_list_synthetic_invitations(
          char(64),integer,integer
        ) TO bodyvision_auth_app;
        UPDATE public.system_schema_state
          SET revision='0025_synthetic_invitations';
    """)


def downgrade() -> None:
    op.execute(
        "DROP FUNCTION public.private_list_synthetic_invitations(char(64),integer,integer)"
    )
    op.execute(
        "DROP FUNCTION public.private_revoke_synthetic_invitation(char(64),uuid,uuid,uuid)"
    )
    op.execute(
        "DROP FUNCTION public.private_accept_synthetic_invitation("
        "char(64),uuid,uuid,text,uuid,uuid)"
    )
    op.execute("DROP FUNCTION public.private_synthetic_invitation_ready(char(64))")
    op.execute(
        "DROP FUNCTION public.private_create_synthetic_invitation("
        "char(64),uuid,char(64),text,text,text,text,uuid,uuid)"
    )
    op.execute("DROP TABLE public.synthetic_user_invitations")
    op.execute("UPDATE public.system_schema_state SET revision='0024_atomic_session_rotation'")
