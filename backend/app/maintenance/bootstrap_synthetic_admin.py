"""One-time first administrator bootstrap for disposable synthetic local databases.

This is NOT self-registration and is not exposed through an HTTP endpoint.
The bootstrap requires privileged migrator access, an explicit human opt-in,
localhost PostgreSQL, and a synthetic organization locked in one transaction.
Production and hosted databases must not use this tool.
"""

import getpass
import os
import re
import sys
from collections.abc import Mapping
from uuid import UUID, uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, Connection, make_url
from sqlalchemy.exc import ArgumentError, SQLAlchemyError
from sqlalchemy.pool import NullPool

from app.core.identity import hash_password


class BootstrapDenied(ValueError):
    """Safe, intentional refusal of a synthetic-only operation."""


def require_synthetic_bootstrap(environment: Mapping[str, str], database_url: str | URL) -> None:
    if environment.get("APP_ENV") not in {"local", "test"}:
        raise BootstrapDenied("El alta inicial solo admite local o test.")
    if environment.get("IDENTITY_ENABLED", "").lower() != "true":
        raise BootstrapDenied("La identidad privada de pruebas debe estar habilitada.")
    if environment.get("BODYVISION_ENABLE_BOOTSTRAP") != "synthetic-only":
        raise BootstrapDenied("Falta la autorización explícita de alta ficticia.")
    try:
        url = make_url(database_url)
    except (ValueError, TypeError, ArgumentError) as exc:
        raise BootstrapDenied("URL de PostgreSQL inválida.") from exc
    if url.drivername != "postgresql+psycopg" or url.host not in {
        "localhost",
        "127.0.0.1",
        "::1",
    }:
        raise BootstrapDenied("Se requiere PostgreSQL de migración por loopback local.")


def bootstrap_synthetic_administrator(
    connection: Connection,
    organization_id: UUID,
    email: str,
    display_name: str,
    password: str,
    *,
    environment: Mapping[str, str],
) -> UUID:
    """Insert user, initial admin role and chained audit in caller's transaction.

    The caller MUST explicitly commit or roll back; no intermediate commits.
    This deliberately cannot provision a non-synthetic or already-bootstrapped
    organization, including when its prior administrator is disabled.
    """
    require_synthetic_bootstrap(environment, connection.engine.url)
    if not connection.in_transaction():
        raise BootstrapDenied("Se requiere una transacción explícita.")
    if not isinstance(organization_id, UUID):
        raise BootstrapDenied("Organización de prueba inválida.")
    normalized = email.strip().lower()
    if (
        len(normalized) > 254
        or re.fullmatch(r"[a-z0-9._%+-]+@example[.]invalid", normalized) is None
        or not (3 <= len(display_name.strip()) <= 100)
        or not (12 <= len(password) <= 128)
    ):
        raise BootstrapDenied("Solo se admiten cuentas ficticias válidas.")

    # Never use the application/auth role to bypass provisioning or RLS.
    privileged = connection.execute(
        text("SELECT rolsuper FROM pg_roles WHERE rolname=current_user")
    ).scalar_one()
    if not privileged:
        raise BootstrapDenied("Se necesita el rol migrador local autorizado.")
    synthetic = connection.execute(
        text("SELECT synthetic FROM public.organizations WHERE id=:org FOR UPDATE"),
        {"org": organization_id},
    ).scalar_one_or_none()
    if synthetic is not True:
        raise BootstrapDenied("La organización no existe o no es sintética.")
    existing = connection.execute(
        text(
            "SELECT count(*) FROM public.user_role_assignments r "
            "WHERE r.organization_id=:org AND r.role='administrator'"
        ),
        {"org": organization_id},
    ).scalar_one()
    if existing:
        raise BootstrapDenied("La organización ya tiene un administrador asignado.")

    user_id = uuid4()
    connection.execute(
        text(
            "INSERT INTO public.users "
            "(id,organization_id,display_name,is_local_operator,"
            "email,password_hash,account_status) "
            "VALUES (:id,:org,:name,false,:email,:verifier,'active')"
        ),
        {
            "id": user_id,
            "org": organization_id,
            "name": display_name.strip(),
            "email": normalized,
            "verifier": hash_password(password),
        },
    )
    connection.execute(
        text(
            "INSERT INTO public.user_role_assignments "
            "(id,organization_id,user_id,role,granted_by) "
            "VALUES (:id,:org,:user,'administrator',NULL)"
        ),
        {"id": uuid4(), "org": organization_id, "user": user_id},
    )
    connection.execute(
        text(
            "INSERT INTO public.security_audit_events "
            "(id,organization_id,actor_id,correlation_id,action,resource_type,resource_id,outcome) "
            "VALUES (:id,:org,:actor,:correlation,'admin.bootstrap_synthetic',"
            "'user',:user,'allowed')"
        ),
        {
            "id": uuid4(),
            "org": organization_id,
            "actor": user_id,
            "correlation": uuid4(),
            "user": user_id,
        },
    )
    return user_id


def main() -> int:
    # Deliberately interactive: never accept a password on argv or by an env
    # variable, where it could leak into process inspection or shell history.
    env = os.environ
    url = env.get("MIGRATION_DATABASE_URL", "")
    try:
        require_synthetic_bootstrap(env, url)
    except BootstrapDenied as exc:
        print(str(exc), file=sys.stderr)
        return 2
    try:
        organization = UUID(input("UUID de organización ficticia: ").strip())
        confirmation = input("Escribe ALTA FICTICIA para confirmar: ").strip()
        if confirmation != "ALTA FICTICIA":
            raise BootstrapDenied("No se confirmó el alta ficticia.")
        email = input("Correo @example.invalid: ").strip()
        display_name = input("Nombre ficticio: ").strip()
        password = getpass.getpass("Contraseña de la cuenta ficticia: ")
        duplicate = getpass.getpass("Repetir contraseña: ")
        if password != duplicate:
            raise BootstrapDenied("Las contraseñas no coinciden.")
        engine = create_engine(url, poolclass=NullPool, hide_parameters=True)
        try:
            with engine.begin() as connection:
                user_id = bootstrap_synthetic_administrator(
                    connection, organization, email, display_name, password, environment=env
                )
        finally:
            engine.dispose()
    except (ValueError, EOFError, KeyboardInterrupt, SQLAlchemyError) as exc:
        if isinstance(exc, BootstrapDenied):
            print(str(exc), file=sys.stderr)
        else:
            print("Alta ficticia detenida sin confirmar una cuenta.", file=sys.stderr)
        return 1
    print(f"Administrador ficticio creado y auditado: {user_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
