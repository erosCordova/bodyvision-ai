"""Synthetic data core, tenant policies and immutable measurement versions."""

import json
from uuid import UUID

import sqlalchemy as sa

from alembic import op

revision = "0002_data_core"
down_revision = "0001_foundation"
branch_labels = None
depends_on = None

DDL = r"""
CREATE TABLE organizations (
 id uuid PRIMARY KEY, name varchar(150) NOT NULL, synthetic boolean NOT NULL CHECK(synthetic),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 display_name varchar(100) NOT NULL, is_local_operator boolean NOT NULL DEFAULT true,
 UNIQUE(organization_id,id)
);
CREATE UNIQUE INDEX one_local_operator ON users(organization_id) WHERE is_local_operator;
CREATE TABLE profiles (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 display_code varchar(24) NOT NULL, display_name varchar(100), birth_year integer NOT NULL,
 sex varchar(10), status varchar(20) NOT NULL DEFAULT 'active',
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(organization_id,display_code),
 FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
 CHECK(birth_year BETWEEN 1900 AND extract(year FROM now())),
 CHECK(sex IS NULL OR sex IN ('male','female','other')),
 CHECK(status IN ('active','restricted','archived'))
);
CREATE TABLE profile_access (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, profile_id uuid NOT NULL,
 user_id uuid NOT NULL, access_level varchar(10) NOT NULL, expires_at timestamptz,
 UNIQUE(organization_id,profile_id,user_id),
 FOREIGN KEY(organization_id,profile_id) REFERENCES profiles(organization_id,id),
 FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id),
 CHECK(access_level IN ('read','write','manage'))
);
CREATE TABLE metric_catalog (
 organization_id uuid NOT NULL REFERENCES organizations(id), code varchar(40) NOT NULL,
 label varchar(100) NOT NULL, unit varchar(10) NOT NULL, min_value numeric NOT NULL,
 max_value numeric NOT NULL, allowed_methods jsonb NOT NULL, precision integer NOT NULL,
 instructions text NOT NULL, position integer NOT NULL, PRIMARY KEY(organization_id,code),
 CHECK(min_value>0 AND max_value>min_value)
);
CREATE TABLE measurements (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, profile_id uuid NOT NULL,
 metric_code varchar(40) NOT NULL, value numeric(8,2) NOT NULL, unit varchar(10) NOT NULL,
 measured_at timestamptz NOT NULL, method varchar(10) NOT NULL, instrument varchar(100),
 notes varchar(500), created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 supersedes_id uuid UNIQUE, correction_reason varchar(500),
 is_current boolean NOT NULL DEFAULT true, outlier_confirmed boolean NOT NULL DEFAULT false,
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,profile_id) REFERENCES profiles(organization_id,id),
 FOREIGN KEY(organization_id,metric_code) REFERENCES metric_catalog(organization_id,code),
 FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,supersedes_id) REFERENCES measurements(organization_id,id),
 CHECK(method IN ('manual','device')),
 CHECK(method!='device' OR COALESCE(length(trim(instrument)),0)>0),
 CHECK((supersedes_id IS NULL AND correction_reason IS NULL) OR
       (supersedes_id IS NOT NULL AND COALESCE(length(trim(correction_reason)),0)>=5))
);
CREATE INDEX measurement_series ON measurements(organization_id,profile_id,metric_code,measured_at DESC) WHERE is_current;
CREATE TABLE idempotency_keys (
 key uuid NOT NULL, organization_id uuid NOT NULL, user_id uuid NOT NULL,
 endpoint varchar(150) NOT NULL, request_hash varchar(64) NOT NULL,
 measurement_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,user_id,key),
 FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,measurement_id) REFERENCES measurements(organization_id,id)
);
CREATE FUNCTION has_profile_access(target uuid, needs_write boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM profile_access a
 WHERE a.profile_id=target
 AND a.organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
 AND a.user_id=NULLIF(current_setting('app.actor_id',true),'')::uuid
 AND (a.expires_at IS NULL OR a.expires_at>now())
 AND (NOT needs_write OR a.access_level IN ('write','manage')))
$$;
REVOKE ALL ON FUNCTION has_profile_access(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION has_profile_access(uuid,boolean) TO bodyvision_app;
CREATE FUNCTION list_local_workspaces() RETURNS TABLE(id uuid,name varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT o.id,o.name FROM organizations o WHERE o.synthetic ORDER BY o.name
$$;
REVOKE ALL ON FUNCTION list_local_workspaces() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_local_workspaces() TO bodyvision_app;
CREATE FUNCTION guard_measurement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE metric metric_catalog%ROWTYPE; prior measurements%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Measurements are immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'is_current') IS DISTINCT FROM (to_jsonb(OLD)-'is_current')
     OR NOT OLD.is_current OR NEW.is_current
     OR NOT EXISTS(SELECT 1 FROM measurements n WHERE n.supersedes_id=OLD.id) THEN
   RAISE EXCEPTION 'Only superseded status may change' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO metric FROM metric_catalog WHERE organization_id=NEW.organization_id AND code=NEW.metric_code;
 IF NOT FOUND OR NEW.value<metric.min_value OR NEW.value>metric.max_value
    OR NEW.unit!=metric.unit OR NOT metric.allowed_methods ? NEW.method
    OR NEW.measured_at>clock_timestamp()
    OR (NEW.method!='manual' AND EXISTS(SELECT 1 FROM profiles p
        WHERE p.id=NEW.profile_id AND extract(year FROM now())-p.birth_year<18)) THEN
  RAISE EXCEPTION 'Invalid observed measurement' USING ERRCODE='23514';
 END IF;
 IF NEW.supersedes_id IS NOT NULL THEN
  SELECT * INTO prior FROM measurements WHERE id=NEW.supersedes_id FOR UPDATE;
  IF NOT FOUND OR NOT prior.is_current OR prior.profile_id!=NEW.profile_id
     OR prior.organization_id!=NEW.organization_id OR prior.metric_code!=NEW.metric_code THEN
   RAISE EXCEPTION 'Invalid correction chain' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_measurements BEFORE INSERT OR UPDATE OR DELETE ON measurements
FOR EACH ROW EXECUTE FUNCTION guard_measurement();
CREATE FUNCTION retire_predecessor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.supersedes_id IS NOT NULL THEN
  UPDATE measurements SET is_current=false WHERE id=NEW.supersedes_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retire_corrected AFTER INSERT ON measurements
FOR EACH ROW EXECUTE FUNCTION retire_predecessor();
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM bodyvision_app;
GRANT SELECT ON system_schema_state TO bodyvision_app;
GRANT SELECT ON organizations,users,metric_catalog TO bodyvision_app;
GRANT SELECT,INSERT ON profiles,profile_access,measurements,idempotency_keys TO bodyvision_app;
GRANT UPDATE(display_name,status) ON profiles TO bodyvision_app;
GRANT UPDATE(is_current) ON measurements TO bodyvision_app;
"""


def upgrade() -> None:
    op.execute(DDL)
    for table in [
        "organizations",
        "users",
        "profiles",
        "profile_access",
        "metric_catalog",
        "measurements",
        "idempotency_keys",
    ]:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        # Do not FORCE owner: owner is reserved for migrations/synthetic seeding.
        tenant = "organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid"
        if table == "organizations":
            tenant = "id=NULLIF(current_setting('app.organization_id',true),'')::uuid"
        if table == "profiles":
            op.execute(
                f"CREATE POLICY profile_read ON profiles FOR SELECT USING ({tenant} AND has_profile_access(id))"
            )
            op.execute(f"CREATE POLICY profile_insert ON profiles FOR INSERT WITH CHECK ({tenant})")
            op.execute(
                f"CREATE POLICY profile_update ON profiles FOR UPDATE USING ({tenant} AND has_profile_access(id,true)) WITH CHECK ({tenant})"
            )
        else:
            condition = tenant
            if table == "measurements":
                condition += " AND has_profile_access(profile_id)"
            if table == "profile_access":
                condition += " AND user_id=NULLIF(current_setting('app.actor_id',true),'')::uuid"
            check = condition
            if table == "measurements":
                check += " AND has_profile_access(profile_id,true)"
            op.execute(
                f"CREATE POLICY tenant_isolation ON {table} USING ({condition}) WITH CHECK ({check})"
            )
    catalog = [
        (
            "weight",
            "Peso",
            "kg",
            20,
            500,
            ["manual", "device"],
            "Utiliza una balanza y registra el método.",
        ),
        (
            "height",
            "Estatura",
            "cm",
            50,
            250,
            ["manual", "device"],
            "Registra la estatura medida, sin calzado.",
        ),
        (
            "waist",
            "Cintura",
            "cm",
            30,
            250,
            ["manual", "device"],
            "Utiliza cinta métrica y un método consistente.",
        ),
        (
            "hip",
            "Cadera",
            "cm",
            30,
            250,
            ["manual", "device"],
            "Utiliza cinta métrica y conserva el método.",
        ),
        (
            "chest",
            "Pecho",
            "cm",
            10,
            250,
            ["manual", "device"],
            "Anota la medición observada con cinta.",
        ),
        (
            "neck",
            "Cuello",
            "cm",
            10,
            150,
            ["manual", "device"],
            "Anota la medición observada con cinta.",
        ),
        (
            "arm",
            "Brazo",
            "cm",
            10,
            150,
            ["manual", "device"],
            "Mantén la misma referencia entre registros.",
        ),
        (
            "thigh",
            "Muslo",
            "cm",
            10,
            150,
            ["manual", "device"],
            "Mantén la misma referencia entre registros.",
        ),
        (
            "body_fat_pct",
            "Grasa corporal",
            "%",
            2,
            70,
            ["device"],
            "Solo valor observado mediante instrumento; nunca desde fotos.",
        ),
        (
            "muscle_mass_kg",
            "Masa muscular",
            "kg",
            0.1,
            300,
            ["device"],
            "Solo valor observado mediante instrumento; nunca desde fotos.",
        ),
    ]
    conn = op.get_bind()
    for suffix, name in [("1", "Centro Horizonte (ficticio)"), ("2", "Estudio Andino (ficticio)")]:
        org = UUID("10000000-0000-4000-8000-00000000000" + suffix)
        actor = UUID("20000000-0000-4000-8000-00000000000" + suffix)
        conn.execute(
            sa.text("INSERT INTO organizations(id,name,synthetic) VALUES (:id,:name,true)"),
            {"id": org, "name": name},
        )
        conn.execute(
            sa.text("INSERT INTO users(id,organization_id,display_name) VALUES (:id,:org,:name)"),
            {"id": actor, "org": org, "name": "Operador ficticio " + suffix},
        )
        for position, (code, label, unit, low, high, methods, instructions) in enumerate(catalog):
            conn.execute(
                sa.text("""INSERT INTO metric_catalog VALUES
                (:org,:code,:label,:unit,:low,:high,CAST(:methods AS jsonb),2,:instructions,:position)"""),
                dict(
                    org=org,
                    code=code,
                    label=label,
                    unit=unit,
                    low=low,
                    high=high,
                    methods=json.dumps(methods),
                    instructions=instructions,
                    position=position,
                ),
            )
    op.execute("UPDATE system_schema_state SET revision='0002_data_core'")


def downgrade() -> None:
    for table in [
        "idempotency_keys",
        "measurements",
        "profile_access",
        "profiles",
        "metric_catalog",
        "users",
        "organizations",
    ]:
        op.execute(f"DROP TABLE {table} CASCADE")
    op.execute("DROP FUNCTION IF EXISTS guard_measurement()")
    op.execute("DROP FUNCTION IF EXISTS retire_predecessor()")
    op.execute("DROP FUNCTION IF EXISTS has_profile_access(uuid,boolean)")
    op.execute("DROP FUNCTION IF EXISTS list_local_workspaces()")
    op.execute("UPDATE system_schema_state SET revision='0001_foundation'")
