"""Atomic offline TOTP key rotation, strictly for synthetic local/test data.

Never accepts raw secrets from command-line arguments. Run only with private
services stopped and a verified external encrypted backup of the old key.
"""

import getpass
import os
import sys
from collections.abc import Mapping
from uuid import UUID, uuid4

from cryptography.fernet import Fernet
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, Connection, make_url
from sqlalchemy.exc import ArgumentError, SQLAlchemyError
from sqlalchemy.pool import NullPool

from app.core.mfa import decrypt_totp_seed, encrypt_totp_seed


class RotationDenied(ValueError):
    """Fail closed without exposing secrets, account IDs, or cipher material."""


def require_local_rotation(environment: Mapping[str, str], database_url: str | URL) -> None:
    if environment.get("APP_ENV") not in {"local", "test"}:
        raise RotationDenied("La rotación MFA solo está disponible en local/test.")
    if environment.get("IDENTITY_ENABLED", "").lower() != "true":
        raise RotationDenied("Se necesita identidad privada sintética.")
    if environment.get("MFA_ENABLED", "").lower() != "true":
        raise RotationDenied("Se necesita MFA habilitado en el entorno ficticio.")
    if environment.get("BODYVISION_ENABLE_MFA_KEY_ROTATION") != "synthetic-only":
        raise RotationDenied("Falta la autorización explícita de rotación ficticia.")
    try:
        url = make_url(database_url)
    except (ValueError, TypeError, ArgumentError) as exc:
        raise RotationDenied("URL de PostgreSQL inválida.") from exc
    if url.drivername != "postgresql+psycopg" or url.host not in {
        "localhost",
        "127.0.0.1",
        "::1",
    }:
        raise RotationDenied("Se exige PostgreSQL migrador en loopback.")


def validate_distinct_keys(old_key: str, new_key: str) -> None:
    try:
        if not old_key or not new_key or old_key == new_key:
            raise RotationDenied("La clave nueva debe ser distinta de la anterior.")
        Fernet(old_key.encode("ascii"))
        Fernet(new_key.encode("ascii"))
    except (ValueError, TypeError, UnicodeError) as exc:
        raise RotationDenied("Claves Fernet de rotación inválidas.") from exc


def rotate_synthetic_mfa_key(
    connection: Connection,
    old_key: str,
    new_key: str,
    *,
    environment: Mapping[str, str],
) -> int:
    """Re-encrypt ALL synthetic MFA seeds and audit in one caller transaction.

    No app/user/auth role can run this; requires local PostgreSQL superuser,
    application stopped, and zero active MFA sessions. Never commits itself.
    Every source seed must decrypt before the first UPDATE, so mixed or
    corrupted ciphers do not allow partial successful rotation.
    """
    require_local_rotation(environment, connection.engine.url)
    validate_distinct_keys(old_key, new_key)
    if not connection.in_transaction():
        raise RotationDenied("Es obligatoria una transacción explícita.")
    privileged = connection.execute(
        text("SELECT rolsuper FROM pg_roles WHERE rolname=current_user")
    ).scalar_one()
    if not privileged:
        raise RotationDenied("Se requiere el rol migrador local autorizado.")

    connection.execute(text("SET LOCAL lock_timeout='5000ms'"))
    connection.execute(
        text("LOCK TABLE public.private_mfa_credentials IN ACCESS EXCLUSIVE MODE")
    )
    non_synthetic = connection.execute(
        text(
            "SELECT count(*) FROM public.private_mfa_credentials c "
            "JOIN public.organizations o ON o.id=c.organization_id "
            "WHERE NOT o.synthetic"
        )
    ).scalar_one()
    if non_synthetic:
        raise RotationDenied("Hay datos no sintéticos: rotación rechazada.")
    active = connection.execute(
        text(
            "SELECT count(*) FROM public.auth_sessions s "
            "JOIN public.private_mfa_credentials c "
            "ON c.organization_id=s.organization_id AND c.user_id=s.user_id "
            "WHERE s.revoked_at IS NULL AND s.expires_at>now()"
        )
    ).scalar_one()
    if active:
        raise RotationDenied("Hay sesiones MFA activas: detén y revoca antes de rotar.")

    source = (
        connection.execute(
            text(
                "SELECT organization_id,user_id,encrypted_totp_seed "
                "FROM public.private_mfa_credentials "
                "ORDER BY organization_id,user_id"
            )
        )
        .mappings()
        .all()
    )
    replacements: list[tuple[UUID, UUID, str, str]] = []
    # First verify *every* previous ciphertext. A wrong or missing old key
    # cannot silently lock out a subset of synthetic accounts.
    for row in source:
        try:
            seed = decrypt_totp_seed(row["encrypted_totp_seed"], old_key)
        except ValueError as exc:
            raise RotationDenied("Una semilla MFA no se pudo descifrar. Sin cambios.") from exc
        new_ciphertext = encrypt_totp_seed(seed, new_key)
        if decrypt_totp_seed(new_ciphertext, new_key) != seed:
            raise RotationDenied("No se verificó el recifrado MFA.")
        replacements.append(
            (row["organization_id"], row["user_id"], row["encrypted_totp_seed"], new_ciphertext)
        )

    organizations: set[UUID] = set()
    for organization, user, previous, current in replacements:
        updated = connection.execute(
            text(
                "UPDATE public.private_mfa_credentials "
                "SET encrypted_totp_seed=:current "
                "WHERE organization_id=:org AND user_id=:user "
                "AND encrypted_totp_seed=:previous"
            ),
            {"org": organization, "user": user, "current": current, "previous": previous},
        ).rowcount
        if updated != 1:
            raise RotationDenied("Concurrencia inesperada: recifrado cancelado.")
        organizations.add(organization)
    for organization in sorted(organizations):
        connection.execute(
            text(
                "INSERT INTO public.security_audit_events "
                "(id,organization_id,actor_id,correlation_id,action,"
                "resource_type,resource_id,outcome) "
                "VALUES (:id,:org,NULL,:correlation,'mfa.key_rotated_synthetic',"
                "'mfa_key',NULL,'allowed')"
            ),
            {"id": uuid4(), "org": organization, "correlation": uuid4()},
        )
    # Read back the persisted values within the same transaction.
    for organization, user, _old, new_ciphertext in replacements:
        stored = connection.execute(
            text(
                "SELECT encrypted_totp_seed FROM public.private_mfa_credentials "
                "WHERE organization_id=:org AND user_id=:user"
            ),
            {"org": organization, "user": user},
        ).scalar_one()
        if stored != new_ciphertext:
            raise RotationDenied("No coincide el resultado persistido de rotación.")
        try:
            decrypt_totp_seed(stored, new_key)
        except ValueError as exc:
            raise RotationDenied("La nueva clave no descifra el resultado.") from exc
    return len(replacements)


def main() -> int:
    environment = os.environ
    url = environment.get("MIGRATION_DATABASE_URL", "")
    try:
        require_local_rotation(environment, url)
        old_key = environment.get("MFA_ROTATION_OLD_KEY", "")
        new_key = environment.get("MFA_ROTATION_NEW_KEY", "")
        validate_distinct_keys(old_key, new_key)
        consent = input("Servicios detenidos y copia cifrada verificada: escribe ROTAR MFA FICTICIO: ")
        if consent.strip() != "ROTAR MFA FICTICIO":
            raise RotationDenied("No se confirmó la operación.")
        # Intentional separate explicit confirmation, but no secret disclosure.
        confirmation = getpass.getpass("Confirma otra vez con ROTAR MFA FICTICIO: ")
        if confirmation != "ROTAR MFA FICTICIO":
            raise RotationDenied("La segunda confirmación no coincide.")
        engine = create_engine(url, poolclass=NullPool, hide_parameters=True)
        try:
            with engine.begin() as connection:
                changed = rotate_synthetic_mfa_key(
                    connection, old_key, new_key, environment=environment
                )
        finally:
            engine.dispose()
    except (RotationDenied, ValueError, EOFError, KeyboardInterrupt, SQLAlchemyError):
        print("Rotación denegada o cancelada. No se confirmó el recifrado.", file=sys.stderr)
        return 1
    print(f"Rotación sintética confirmada para {changed} semillas. "
          "Configura la clave nueva antes de reabrir el servicio.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
