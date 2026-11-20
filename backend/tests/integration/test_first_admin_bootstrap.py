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
EMAIL = "primer-administrador@example.invalid"
PASSWORD = "Solo para pruebas sintéticas 2026!"


@pytest.mark.parametrize(
    ("changes", "url"),
    [
        ({"APP_ENV": "production"}, "postgresql+psycopg://postgres@localhost/bodyvision"),
        ({"APP_ENV": "demo"}, "postgresql+psycopg://postgres@localhost/bodyvision"),
        ({"IDENTITY_ENABLED": "false"}, "postgresql+psycopg://postgres@localhost/bodyvision"),
        ({"BODYVISION_ENABLE_BOOTSTRAP": ""}, "postgresql+psycopg://postgres@localhost/bodyvision"),
        ({}, "postgresql+psycopg://postgres@database.example.com/bodyvision"),
        ({}, "postgresql+psycopg://postgres@10.1.2.3/bodyvision"),
        ({}, "sqlite:///data.sqlite"),
    ],
)
def test_bootstrap_refuses_deployments_and_nonlocal_database(changes, url):
    with pytest.raises(BootstrapDenied):
        require_synthetic_bootstrap({**PERMITTED, **changes}, url)


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
                created = bootstrap_synthetic_administrator(
                    conn,
                    organization,
                    EMAIL,
                    "Primer administrador ficticio",
                    PASSWORD,
                    environment=PERMITTED,
                )
                account = conn.execute(
                    text(
                        "SELECT email,password_hash,is_local_operator,account_status "
                        "FROM public.users WHERE id=:user"
                    ),
                    {"user": created},
                ).mappings().one()
                assert account["email"] == EMAIL
                assert PASSWORD not in account["password_hash"]
                assert verify_password(PASSWORD, account["password_hash"])
                assert not account["is_local_operator"]
                assert account["account_status"] == "active"
                assert conn.execute(
                    text(
                        "SELECT count(*) FROM public.user_role_assignments "
                        "WHERE organization_id=:org AND user_id=:user "
                        "AND role='administrator' AND granted_by IS NULL"
                    ),
                    {"org": organization, "user": created},
                ).scalar_one() == 1
                audit = conn.execute(
                    text(
                        "SELECT action,chain_sequence,previous_hash,event_hash "
                        "FROM public.security_audit_events "
                        "WHERE organization_id=:org AND actor_id=:user"
                    ),
                    {"org": organization, "user": created},
                ).mappings().one()
                assert audit["action"] == "admin.bootstrap_synthetic"
                assert audit["chain_sequence"] == 1
                assert audit["previous_hash"] == "0" * 64
                assert len(audit["event_hash"]) == 64
                with pytest.raises(BootstrapDenied, match="ya tiene"):
                    bootstrap_synthetic_administrator(
                        conn,
                        organization,
                        "otra-cuenta@example.invalid",
                        "Segundo administrador ficticio",
                        PASSWORD,
                        environment=PERMITTED,
                    )
                assert conn.execute(
                    text(
                        "SELECT count(*) FROM public.users "
                        "WHERE organization_id=:org AND NOT is_local_operator"
                    ),
                    {"org": organization},
                ).scalar_one() == 1
                assert conn.execute(
                    text(
                        "SELECT count(*) FROM public.security_audit_events "
                        "WHERE organization_id=:org"
                    ),
                    {"org": organization},
                ).scalar_one() == 1
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
                    bootstrap_synthetic_administrator(
                        conn, missing, EMAIL, "Persona ficticia",
                        PASSWORD, environment=PERMITTED,
                    )
                with pytest.raises(BootstrapDenied, match="cuentas ficticias"):
                    bootstrap_synthetic_administrator(
                        conn, missing, "admin@gmail.com", "Persona ficticia",
                        PASSWORD, environment=PERMITTED,
                    )
                with pytest.raises(BootstrapDenied, match="cuentas ficticias"):
                    bootstrap_synthetic_administrator(
                        conn, missing, EMAIL, "Persona ficticia",
                        "short", environment=PERMITTED,
                    )
                assert conn.execute(
                    text("SELECT count(*) FROM public.users WHERE email=:email"),
                    {"email": EMAIL},
                ).scalar_one() == 0
            finally:
                transaction.rollback()
    finally:
        engine.dispose()
