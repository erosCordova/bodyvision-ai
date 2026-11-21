"""Security schema smoke tests against a real ephemeral PostgreSQL database."""

import os
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from app.models.context import FIRST_WORKSPACE


@pytest.fixture
def database():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Only runs against the CI/local disposable PostgreSQL database")
    engine = create_engine(url)
    try:
        yield engine
    finally:
        engine.dispose()


def test_phase3_schema_is_present_and_access_is_denied_by_default(database):
    with database.connect() as conn:
        assert (
            conn.execute(text("SELECT revision FROM system_schema_state")).scalar_one()
            == "0020_pose_summaries"
        )
        for table in (
            "user_role_assignments",
            "auth_sessions",
            "profile_consents",
            "security_audit_events",
            "private_mfa_credentials",
            "private_mfa_recovery_codes",
        ):
            assert not conn.execute(
                text("SELECT has_table_privilege('bodyvision_app', :table, 'SELECT')"),
                {"table": f"public.{table}"},
            ).scalar_one()
            assert not conn.execute(
                text("SELECT has_table_privilege('bodyvision_app', :table, 'INSERT')"),
                {"table": f"public.{table}"},
            ).scalar_one()
            assert conn.execute(
                text("SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass(:table)"),
                {"table": f"public.{table}"},
            ).scalar_one()


def test_runtime_roles_cannot_directly_modify_private_security_data(database):
    with database.connect() as connection:
        for role in ("bodyvision_app", "bodyvision_auth_app"):
            for table in (
                "security_audit_events",
                "private_audit_heads",
                "auth_login_attempts",
                "private_profile_permission_changes",
                "profile_consents",
                "auth_sessions",
                "private_mfa_credentials",
                "private_mfa_recovery_codes",
            ):
                for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
                    assert not connection.execute(
                        text("SELECT has_table_privilege(:role,:table,:privilege)"),
                        {"role": role, "table": table, "privilege": privilege},
                    ).scalar_one()
        assert not connection.execute(
            text("SELECT has_table_privilege('bodyvision_auth_app','users','INSERT')")
        ).scalar_one()
        for table, privilege in (("users", "UPDATE"), ("auth_sessions", "INSERT")):
            assert not connection.execute(
                text("SELECT has_any_column_privilege('bodyvision_auth_app',:table,:privilege)"),
                {"table": table, "privilege": privilege},
            ).scalar_one()
        assert connection.execute(
            text(
                "SELECT has_function_privilege("
                "'bodyvision_auth_app',"
                "'manage_private_profile_permission(char(64),uuid,uuid,text,uuid,uuid,uuid)',"
                "'EXECUTE')"
            )
        ).scalar_one()
        for signature in (
            "private_profile_consents(char(64),uuid,text,text,uuid,uuid,uuid,uuid)",
            "private_admin_users(char(64),text,integer,integer)",
            "private_permission_catalog(char(64),uuid,text)",
            "set_synthetic_account_status(char(64),uuid,text,text,uuid,uuid)",
            "private_admin_audit(char(64),integer)",
            "private_own_sessions(char(64),integer,integer)",
            "private_own_security_change(char(64),text,uuid,text,text,uuid,uuid)",
            "verify_private_audit_chain(char(64),uuid,uuid)",
            "private_mfa_snapshot(uuid,uuid,text)",
            "private_mfa_transition(uuid,uuid,text,text,text,bigint,uuid,text,jsonb,uuid,uuid)",
            "private_mfa_mark_session(uuid,uuid,text,char(64))",
            "private_mfa_session_verified(char(64))",
            "private_mfa_reset_with_recovery(uuid,uuid,text,uuid,text,text,uuid,uuid)",
        ):
            for role, permitted in (("bodyvision_app", False), ("bodyvision_auth_app", True)):
                assert (
                    connection.execute(
                        text("SELECT has_function_privilege(:role,:signature,'EXECUTE')"),
                        {"role": role, "signature": signature},
                    ).scalar_one()
                    is permitted
                )


def test_fixture_operators_are_disabled_for_login(database):
    with database.connect() as conn:
        operators = (
            conn.execute(
                text("SELECT email,password_hash,account_status FROM users WHERE is_local_operator")
            )
            .mappings()
            .all()
        )
        assert operators
        assert all(
            u["email"] is None and u["password_hash"] is None and u["account_status"] == "disabled"
            for u in operators
        )


def test_consent_is_versioned_and_requires_consistent_status(database):
    with database.connect() as conn:
        tx = conn.begin()
        try:
            actor = conn.execute(
                text(
                    "SELECT id FROM users WHERE organization_id=:organization AND is_local_operator"
                ),
                {"organization": FIRST_WORKSPACE},
            ).scalar_one()
            profile_id = uuid4()
            conn.execute(
                text(
                    "INSERT INTO profiles("
                    "id,organization_id,display_code,birth_year,created_by"
                    ") VALUES (:id,:org,:code,1995,:actor)"
                ),
                {
                    "id": profile_id,
                    "org": FIRST_WORKSPACE,
                    "code": "SEC-" + profile_id.hex[:12],
                    "actor": actor,
                },
            )
            consent_id = uuid4()
            values = {
                "id": consent_id,
                "org": FIRST_WORKSPACE,
                "profile": profile_id,
                "actor": actor,
            }
            conn.execute(
                text(
                    "INSERT INTO profile_consents "
                    "(id,organization_id,profile_id,purpose,version,status,"
                    "accepted_at,recorded_by) "
                    "VALUES (:id,:org,:profile,'capture','v1','accepted',now(),:actor)"
                ),
                values,
            )
            with pytest.raises(IntegrityError):
                with conn.begin_nested():
                    conn.execute(
                        text(
                            "INSERT INTO profile_consents "
                            "(id,organization_id,profile_id,purpose,version,status,"
                            "recorded_by) "
                            "VALUES (:id,:org,:profile,'pose','v1','accepted',:actor)"
                        ),
                        {**values, "id": uuid4()},
                    )
            conn.execute(
                text("UPDATE profile_consents SET status='revoked',revoked_at=now() WHERE id=:id"),
                {"id": consent_id},
            )
            result = conn.execute(
                text("SELECT status,revoked_at FROM profile_consents WHERE id=:id"),
                {"id": consent_id},
            ).one()
            assert result.status == "revoked"
            assert result.revoked_at is not None
        finally:
            tx.rollback()
