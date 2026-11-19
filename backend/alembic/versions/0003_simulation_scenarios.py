"""Append-only synthetic simulation scenarios, separate from observed measurements."""

from alembic import op

revision = "0003_simulation_scenarios"
down_revision = "0002_data_core"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE simulation_scenarios (
          id uuid PRIMARY KEY,
          organization_id uuid NOT NULL,
          profile_id uuid NOT NULL,
          series_id uuid NOT NULL,
          version integer NOT NULL CHECK(version BETWEEN 1 AND 10000),
          prior_version_id uuid,
          reference_kg numeric(5,1) NOT NULL CHECK(reference_kg BETWEEN 40 AND 200),
          variation_percent integer NOT NULL CHECK(variation_percent BETWEEN -30 AND 30),
          stature_cm integer NOT NULL CHECK(stature_cm BETWEEN 145 AND 205),
          simulated_kg numeric(6,1) GENERATED ALWAYS AS
            (round(reference_kg * (1 + variation_percent::numeric / 100), 1)) STORED,
          model_revision varchar(40) NOT NULL,
          algorithm_revision varchar(50) NOT NULL,
          revision_note varchar(200),
          created_by uuid NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(organization_id,id),
          UNIQUE(organization_id,profile_id,series_id,version),
          UNIQUE(prior_version_id),
          FOREIGN KEY(organization_id,profile_id)
            REFERENCES profiles(organization_id,id),
          FOREIGN KEY(organization_id,created_by)
            REFERENCES users(organization_id,id),
          FOREIGN KEY(organization_id,prior_version_id)
            REFERENCES simulation_scenarios(organization_id,id),
          CHECK(
            (version=1 AND prior_version_id IS NULL AND series_id=id
              AND revision_note IS NULL)
            OR
            (version>1 AND prior_version_id IS NOT NULL
              AND revision_note IS NOT NULL AND length(trim(revision_note))>=5)
          )
        );
        CREATE INDEX scenario_history_by_profile ON simulation_scenarios
          (organization_id,profile_id,created_at DESC,id);
        CREATE INDEX scenario_history_by_series ON simulation_scenarios
          (organization_id,profile_id,series_id,version DESC);

        CREATE FUNCTION guard_simulation_scenario() RETURNS trigger LANGUAGE plpgsql
        SECURITY INVOKER AS $$
        DECLARE previous simulation_scenarios%ROWTYPE;
        BEGIN
          IF TG_OP <> 'INSERT' THEN
            RAISE EXCEPTION 'Simulation history is append-only' USING ERRCODE='23514';
          END IF;
          IF NEW.version=1 THEN
            IF NEW.prior_version_id IS NOT NULL OR NEW.series_id<>NEW.id THEN
              RAISE EXCEPTION 'Invalid simulation origin' USING ERRCODE='23514';
            END IF;
          ELSE
            SELECT * INTO previous FROM simulation_scenarios
              WHERE organization_id=NEW.organization_id AND id=NEW.prior_version_id;
            IF NOT FOUND OR previous.profile_id<>NEW.profile_id
              OR previous.series_id<>NEW.series_id
              OR previous.version+1<>NEW.version
              OR previous.model_revision<>NEW.model_revision
              OR previous.algorithm_revision<>NEW.algorithm_revision THEN
              RAISE EXCEPTION 'Invalid simulation version chain' USING ERRCODE='23514';
            END IF;
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER immutable_simulation_scenarios
          BEFORE INSERT OR UPDATE OR DELETE ON simulation_scenarios
          FOR EACH ROW EXECUTE FUNCTION guard_simulation_scenario();

        CREATE TABLE simulation_request_keys (
          organization_id uuid NOT NULL,
          actor_id uuid NOT NULL,
          key uuid NOT NULL,
          request_hash varchar(64) NOT NULL,
          scenario_id uuid NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(organization_id,actor_id,key),
          FOREIGN KEY(organization_id,actor_id) REFERENCES users(organization_id,id),
          FOREIGN KEY(organization_id,scenario_id)
            REFERENCES simulation_scenarios(organization_id,id)
        );

        ALTER TABLE simulation_scenarios ENABLE ROW LEVEL SECURITY;
        CREATE POLICY simulation_read ON simulation_scenarios FOR SELECT
          USING (
            organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
            AND has_profile_access(profile_id)
          );
        CREATE POLICY simulation_insert ON simulation_scenarios FOR INSERT
          WITH CHECK (
            organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
            AND created_by=NULLIF(current_setting('app.actor_id',true),'')::uuid
            AND has_profile_access(profile_id,true)
          );
        ALTER TABLE simulation_request_keys ENABLE ROW LEVEL SECURITY;
        CREATE POLICY scenario_key_isolation ON simulation_request_keys
          USING (
            organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
            AND actor_id=NULLIF(current_setting('app.actor_id',true),'')::uuid
          ) WITH CHECK (
            organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
            AND actor_id=NULLIF(current_setting('app.actor_id',true),'')::uuid
          );
        REVOKE ALL ON simulation_scenarios,simulation_request_keys FROM bodyvision_app;
        GRANT SELECT,INSERT ON simulation_scenarios,simulation_request_keys
          TO bodyvision_app;
        UPDATE system_schema_state SET revision='0003_simulation_scenarios';
    """)


def downgrade() -> None:
    op.execute("DROP TABLE simulation_request_keys")
    op.execute("DROP TABLE simulation_scenarios")
    op.execute("DROP FUNCTION guard_simulation_scenario()")
    op.execute("UPDATE system_schema_state SET revision='0002_data_core'")
