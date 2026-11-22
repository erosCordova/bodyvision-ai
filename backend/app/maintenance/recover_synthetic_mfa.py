"""Owner-only offline reset of a lost fictional MFA factor; never an HTTP bypass."""

import os
import sys
from collections.abc import Mapping
from uuid import UUID, uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, Connection, make_url
from sqlalchemy.exc import ArgumentError, SQLAlchemyError
from sqlalchemy.pool import NullPool


class RecoveryDenied(ValueError):
    """Safe refusal without printing credentials, seeds, tokens or account data."""


def require_local_recovery(environment: Mapping[str, str], database_url: str | URL) -> None:
    if (
        environment.get("APP_ENV") not in {"local", "test"}
        or environment.get("IDENTITY_ENABLED", "").lower() != "true"
        or environment.get("MFA_ENABLED", "").lower() != "true"
        or environment.get("BODYVISION_ENABLE_MFA_ASSISTED_RECOVERY") != "synthetic-only"
    ):
        raise RecoveryDenied("Se requiere recuperación MFA ficticia autorizada en local/test.")
    try:
        url = make_url(database_url)
    except (ValueError, TypeError, ArgumentError) as exc:
        raise RecoveryDenied("URL de PostgreSQL inválida.") from exc
    if url.drivername != "postgresql+psycopg" or url.host not in {"localhost", "127.0.0.1", "::1"}:
        raise RecoveryDenied("Se exige PostgreSQL migrador en loopback.")


def recover_synthetic_mfa(
    connection: Connection,
    organization_id: UUID,
    user_id: UUID,
    review_id: UUID,
    *,
    confirmed_user_id: UUID,
    environment: Mapping[str, str],
) -> int:
    """Invalidate a confirmed factor and all sessions in a caller transaction.

    The operator supplies a unique fictional review reference (audit event ID).
    This records the reference, not verified human identity or legal approval.
    A savepoint rolls back our changes even if a caller catches the exception.
    Password, roles and profile grants remain unchanged. New enrollment still
    requires the current password and TOTP confirmation before privileged login.
    """
    require_local_recovery(environment, connection.engine.url)
    if not connection.in_transaction():
        raise RecoveryDenied("Se exige una transacción explícita.")
    if not all(isinstance(value, UUID) for value in (organization_id, user_id, review_id)):
        raise RecoveryDenied("Los identificadores de revisión deben ser UUID.")
    if confirmed_user_id != user_id:
        raise RecoveryDenied("La segunda confirmación de la cuenta no coincide.")
    if not connection.execute(
        text("SELECT rolsuper FROM pg_roles WHERE rolname=current_user")
    ).scalar_one():
        raise RecoveryDenied("Se requiere el rol migrador local autorizado.")
    runtime_connections = connection.execute(
        text("""SELECT count(*) FROM pg_stat_activity
            WHERE datname=current_database() AND pid<>pg_backend_pid()
              AND usename IN ('bodyvision_app','bodyvision_auth_app')""")
    ).scalar_one()
    if runtime_connections:
        raise RecoveryDenied(
            "Detén las conexiones de aplicación y autenticación antes de recuperar."
        )

    with connection.begin_nested():
        connection.execute(text("SET LOCAL lock_timeout='5000ms'"))
        target = connection.execute(
            text("""SELECT u.id FROM public.users u JOIN public.organizations o
                ON o.id=u.organization_id
                WHERE o.id=:org AND o.synthetic AND u.id=:user
                  AND u.account_status='active' AND NOT u.is_local_operator
                  AND split_part(u.email,'@',2)='example.invalid'
                  AND u.password_hash IS NOT NULL
                FOR UPDATE OF u"""),
            {"org": organization_id, "user": user_id},
        ).scalar_one_or_none()
        roles = (
            connection.execute(
                text("""SELECT role FROM public.user_role_assignments
                WHERE organization_id=:org AND user_id=:user
                  AND (expires_at IS NULL OR expires_at>clock_timestamp())"""),
                {"org": organization_id, "user": user_id},
            )
            .scalars()
            .all()
        )
        if target is None or len(roles) != 1 or roles[0] not in {"administrator", "specialist"}:
            raise RecoveryDenied("Cuenta ficticia privilegiada activa no disponible.")
        confirmed = connection.execute(
            text("""SELECT confirmed_at FROM public.private_mfa_credentials
                WHERE organization_id=:org AND user_id=:user FOR UPDATE"""),
            {"org": organization_id, "user": user_id},
        ).scalar_one_or_none()
        if confirmed is None:
            raise RecoveryDenied("No existe un factor MFA confirmado que recuperar.")
        if connection.execute(
            text("SELECT 1 FROM public.security_audit_events WHERE id=:review"),
            {"review": review_id},
        ).first():
            raise RecoveryDenied("La referencia de revisión ya se utilizó.")
        # Both authenticated MFA transitions and session issuance serialize on
        # the locked users row. Recovery cannot leave an older session usable.
        revoked = connection.execute(
            text("""UPDATE public.auth_sessions SET revoked_at=clock_timestamp()
                WHERE organization_id=:org AND user_id=:user AND revoked_at IS NULL"""),
            {"org": organization_id, "user": user_id},
        ).rowcount
        # Recovery verifiers are deleted by the existing ON DELETE CASCADE.
        connection.execute(
            text("""DELETE FROM public.private_mfa_credentials
                WHERE organization_id=:org AND user_id=:user"""),
            {"org": organization_id, "user": user_id},
        )
        connection.execute(
            text("""INSERT INTO public.security_audit_events
                (id,organization_id,actor_id,correlation_id,action,resource_type,resource_id,outcome)
                VALUES (:review,:org,NULL,:correlation,'mfa.recovery_synthetic_offline',
                    'user',:user,'allowed')"""),
            {"review": review_id, "org": organization_id, "correlation": uuid4(), "user": user_id},
        )
    return revoked


def main() -> int:
    environment = os.environ
    url = environment.get("MIGRATION_DATABASE_URL", "")
    try:
        require_local_recovery(environment, url)
        organization = UUID(input("UUID de organización ficticia: ").strip())
        user = UUID(input("UUID de cuenta ficticia revisada: ").strip())
        review = UUID(input("UUID único de revisión ficticia (evento de auditoría): ").strip())
        if input("Servicios detenidos. Escribe RECUPERAR MFA FICTICIO: ").strip() != (
            "RECUPERAR MFA FICTICIO"
        ):
            raise RecoveryDenied("No se confirmó la recuperación.")
        confirmed = UUID(input("Repite el UUID de la cuenta ficticia: ").strip())
        engine = create_engine(url, poolclass=NullPool, hide_parameters=True)
        try:
            with engine.begin() as connection:
                recover_synthetic_mfa(
                    connection,
                    organization,
                    user,
                    review,
                    confirmed_user_id=confirmed,
                    environment=environment,
                )
        finally:
            engine.dispose()
    except (ValueError, SQLAlchemyError, EOFError, KeyboardInterrupt):
        print("Recuperación denegada o cancelada; no se confirmó el cambio.", file=sys.stderr)
        return 1
    print("Recuperación ficticia auditada. Se exige contraseña actual y configurar MFA nuevamente.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
