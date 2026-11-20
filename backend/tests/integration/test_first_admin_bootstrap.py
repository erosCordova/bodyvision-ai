"""First-admin bootstrap acceptance against ephemeral PostgreSQL only."""

import os
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text

from app.core.identity import verify_password
from app.maintenance.bootstrap_synthetic_admin import (
    BootstrapDenied,
    bootstrap_synthetic_administrator,
    require_synthetic_bootstrap,
)

PERMITTED = {
    "APP_ENV": "test",
    "IDENTITY_ENABLED": "true",
    "BODYVISION_ENABLE_BOOTSTRAP": "synthetic-only",
}
LOCAL_URL = "postgresql+psycopg://postgres@localhost/bodyvision"
EMAIL = "primer-administrador@example.invalid"
PASSWORD = "Solo para pruebas sintéticas 2026!"


@pytest.mark.parametrize(
    ("changes", "url"),
    [
        ({"APP_ENV": "production"}, LOCAL_URL),
        ({"APP_ENV": "demo"}, LOCAL_URL),
        ({"IDENTITY_ENABLED": "false"}, LOCAL_URL),
        ({"BODYVISION_ENABLE_BOOTSTRAP": ""}, LOCAL_URL),
        ({}, "postgresql+psycopg://postgres@database.example.com/bodyvision"),
        ({}, "postgresql+psycopg://postgres@10.1.2.3/bodyvision"),
        ({}, "sqlite:///data.sqlite"),
    ],
)
def test_bootstrap_refuses_deployments_and_nonlocal_database(changes, url):
    with pytest.raises(BootstrapDenied):
        require_synthetic_bootstrap({**PERMITTED, **changes}, url)


def create_first_admin(connection, org, email=EMAIL, password=PASSWORD):
    return bootstrap_synthetic_administrator(
        connection,
        org,
        email,
        "Primer administrador ficticio",
        password,
        environment=PERMITTED,
    )


def test_bootstrap_creates_one_local_synthetic_admin_and_chained_audit():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Requires isolated PostgreSQL test service")
    engine = create_engine(url, hide_parameters=True)
    try:
        with engine.connect() as conn:
            transaction = conn.begin()
            try:
                organization = uuid4()
                conn.execute(
                    text(
                        "INSERT INTO public.organizations(id,name,synthetic) "
                        "VALUES (:id,'Organización ficticia de alta',true)"
                    ),
                    {"id": organization},
                )
                created = create_first_admin(conn, organization)
                account_rows = conn.execute(
                    text(
                        "SELECT email,password_hash,is_local_operator,account_status "
                        "FROM public.users WHERE id=:user"
                    ),
                    {"user": created},
                )
                account = account_rows.mappings().one()
                assert account["email"] == EMAIL
                assert PASSWORD not in account["password_hash"]
                assert verify_password(PASSWORD, account["password_hash"])
                assert not account["is_local_operator"]
                assert account["account_status"] == "active"
                role_rows = conn.execute(
                    text(
                        "SELECT count(*) FROM public.user_role_assignments "
                        "WHERE organization_id=:org AND user_id=:user "
                        "AND role='administrator' AND granted_by IS NULL"
                    ),
                    {"org": organization, "user": created},
                )
                assert role_rows.scalar_one() == 1
                audit_rows = conn.execute(
                    text(
                        "SELECT action,chain_sequence,previous_hash,event_hash "
                        "FROM public.security_audit_events "
                        "WHERE organization_id=:org AND actor_id=:user"
                    ),
                    {"org": organization, "user": created},
                )
                audit = audit_rows.mappings().one()
                assert audit["action"] == "admin.bootstrap_synthetic"
                assert audit["chain_sequence"] == 1
                assert audit["previous_hash"] == "0" * 64
                assert len(audit["event_hash"]) == 64
                with pytest.raises(BootstrapDenied, match="ya tiene"):
                    create_first_admin(
                        conn, organization, email="otra-cuenta@example.invalid"
                    )
                user_count = conn.execute(
                    text(
                        "SELECT count(*) FROM public.users "
                        "WHERE organization_id=:org AND NOT is_local_operator"
                    ),
                    {"org": organization},
                )
                assert user_count.scalar_one() == 1
                audit_count = conn.execute(
                    text(
                        "SELECT count(*) FROM public.security_audit_events "
                        "WHERE organization_id=:org"
                    ),
                    {"org": organization},
                )
                assert audit_count.scalar_one() == 1
            finally:
                # Isolated transaction: never persist bootstrap test credentials.
                transaction.rollback()
    finally:
        engine.dispose()


def test_bootstrap_rejects_nonsynthetic_org_and_bad_identity_before_writes():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Requires isolated PostgreSQL test service")
    engine = create_engine(url, hide_parameters=True)
    try:
        with engine.connect() as conn:
            transaction = conn.begin()
            try:
                missing = uuid4()
                with pytest.raises(BootstrapDenied, match="no existe"):
                    create_first_admin(conn, missing)
                with pytest.raises(BootstrapDenied, match="cuentas ficticias"):
                    create_first_admin(conn, missing, email="admin@gmail.com")
                with pytest.raises(BootstrapDenied, match="cuentas ficticias"):
                    create_first_admin(conn, missing, password="short")
                user_count = conn.execute(
                    text("SELECT count(*) FROM public.users WHERE email=:email"),
                    {"email": EMAIL},
                )
                assert user_count.scalar_one() == 0
            finally:
                transaction.rollback()
    finally:
        engine.dispose()
