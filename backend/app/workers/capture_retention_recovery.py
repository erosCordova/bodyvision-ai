"""Verify that purged synthetic captures do not reappear from a restored copy.

The scheduled worker deletes expired ciphertext from the active database, but
no database can prove that an older backup, WAL segment, snapshot or replica
will not resurrect it later. This module answers a narrower, honest question:

    given a manifest of captures purged from the active database, are any of
    them present in a restored copy consulted in read-only mode?

Even a clean result never becomes "verified global deletion": the report keeps
``global_verified_deletion`` false and lists the surfaces it cannot inspect.
Synthetic local/test only, never used by the API or the retention worker.
"""

import argparse
import json
import os
import re
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from sqlalchemy import bindparam, create_engine, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import ArgumentError, SQLAlchemyError
from sqlalchemy.pool import NullPool

DIGEST = re.compile(r"[0-9a-f]{64}")
RLS_SCOPED_ROLES = {"bodyvision_app", "bodyvision_auth_app"}
STATUS_NO_REAPPEARANCE = "no-reappearance-observed"
STATUS_DISCREPANCY = "discrepancy"
GLOBAL_LIMITS = (
    "Solo compara la base activa con la copia restaurada indicada, en lectura.",
    "No inspecciona WAL, archivos de respaldo, instantáneas de almacenamiento, "
    "réplicas ni custodia externa.",
    "Un respaldo anterior puede reactivar la captura; mientras eso sea posible "
    "no se declara borrado global verificado.",
    "No sustituye aceptación clínica, legal, de privacidad ni revisión externa.",
)


class RecoveryVerificationDenied(ValueError):
    """Refuse an unsafe or incomplete verification without echoing secrets."""


class RecoveryVerificationError(RuntimeError):
    """The restored copy could not be inspected; never includes connection data."""


@dataclass(frozen=True)
class PurgedCapture:
    identifier: UUID
    sha256_digest: str


def load_manifest(path: str | Path) -> tuple[PurgedCapture, ...]:
    """Read a JSON manifest of purged captures and validate it strictly."""
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RecoveryVerificationDenied("Manifiesto de purga ilegible.") from exc
    entries = payload.get("purged_captures") if isinstance(payload, dict) else payload
    if not isinstance(entries, list) or not entries:
        raise RecoveryVerificationDenied("El manifiesto de purga está vacío.")
    unique: dict[UUID, PurgedCapture] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise RecoveryVerificationDenied("Entrada de manifiesto no válida.")
        raw_id, digest = entry.get("id"), entry.get("sha256_digest")
        if not isinstance(digest, str) or DIGEST.fullmatch(digest) is None:
            raise RecoveryVerificationDenied("Digest de manifiesto no válido.")
        try:
            identifier = UUID(str(raw_id))
        except (ValueError, TypeError, AttributeError) as exc:
            raise RecoveryVerificationDenied("Identificador de manifiesto no válido.") from exc
        prior = unique.get(identifier)
        if prior is not None and prior.sha256_digest != digest:
            # A contradictory manifest must not silently hide a capture.
            raise RecoveryVerificationDenied("Manifiesto con digest contradictorio.")
        unique[identifier] = PurgedCapture(identifier, digest)
    return tuple(unique.values())


def require_verification_environment(environment: Mapping[str, str]) -> str:
    """Only a synthetic local/test rehearsal may inspect a restored copy."""
    if environment.get("APP_ENV") not in {"local", "test"}:
        raise RecoveryVerificationDenied("Verificación de restauración: solo local/test.")
    if environment.get("BODYVISION_ENABLE_CAPTURE_RETENTION") != "synthetic-only":
        raise RecoveryVerificationDenied("Se requiere activación sintética explícita.")
    url = environment.get("RESTORED_DATABASE_URL", "")
    try:
        parsed = make_url(url)
    except (ArgumentError, TypeError, ValueError):
        raise RecoveryVerificationDenied("Conexión de restauración inválida.") from None
    if parsed.drivername != "postgresql+psycopg" or parsed.host not in {
        "localhost",
        "127.0.0.1",
        "::1",
    }:
        # A test fixture must never query an external/production database.
        raise RecoveryVerificationDenied("La copia debe estar en PostgreSQL local de pruebas.")
    return url


def read_only_engine(url: str) -> Engine:
    """Read-only, bounded, no-pool engine: a restored copy is never mutated."""
    # Also fail closed for programmatic callers that bypass the CLI guard.
    require_verification_environment(
        {
            "APP_ENV": "test",
            "BODYVISION_ENABLE_CAPTURE_RETENTION": "synthetic-only",
            "RESTORED_DATABASE_URL": url,
        }
    )
    return create_engine(
        url,
        poolclass=NullPool,
        hide_parameters=True,
        connect_args={
            "connect_timeout": 3,
            "options": "-c statement_timeout=5000 -c default_transaction_read_only=on",
        },
    )


def find_reappeared(engine: Engine, manifest: Sequence[PurgedCapture]) -> list[dict[str, str]]:
    """Return manifest captures still present in the restored copy."""
    if not manifest:
        raise RecoveryVerificationDenied("Se requiere un manifiesto no vacío.")
    statement = text(
        "SELECT id,sha256_digest FROM synthetic_capture_objects "
        "WHERE id IN :identifiers OR sha256_digest IN :digests"
    ).bindparams(bindparam("identifiers", expanding=True), bindparam("digests", expanding=True))
    try:
        with engine.connect() as connection:
            # A newly introduced tenant-scoped role may have a different name.
            # row_security_active checks the effective session, not a static list.
            role, scoped, can_read = connection.execute(
                text(
                    "SELECT current_user, "
                    "row_security_active('public.synthetic_capture_objects'::regclass), "
                    "has_table_privilege(current_user, "
                    "'public.synthetic_capture_objects', 'SELECT')"
                )
            ).one()
            if role in RLS_SCOPED_ROLES or scoped or not can_read:
                raise RecoveryVerificationDenied(
                    "Verifica la copia aislada con un rol autorizado sin RLS."
                )
            rows = connection.execute(
                statement,
                {
                    "identifiers": [entry.identifier for entry in manifest],
                    "digests": [entry.sha256_digest for entry in manifest],
                },
            ).all()
    except SQLAlchemyError as exc:
        # Drivers can embed credentials and SQL text in their messages.
        raise RecoveryVerificationError(
            f"La copia restaurada no permite verificar capturas ({type(exc).__name__})."
        ) from None
    reappeared = [{"id": str(row[0]), "sha256_digest": str(row[1]).strip()} for row in rows]
    return sorted(reappeared, key=lambda entry: entry["id"])


def build_report(
    manifest: Sequence[PurgedCapture], reappeared: Sequence[dict[str, str]]
) -> dict[str, object]:
    """Never promote a clean comparison into a global deletion verdict."""
    return {
        "scope": "restored-synthetic-copy",
        "checked_captures": len(manifest),
        "reappeared": list(reappeared),
        "reappeared_count": len(reappeared),
        "status": STATUS_DISCREPANCY if reappeared else STATUS_NO_REAPPEARANCE,
        "global_verified_deletion": False,
        "limits": list(GLOBAL_LIMITS),
    }


def verify_restored_copy(engine: Engine, manifest: Sequence[PurgedCapture]) -> dict[str, object]:
    return build_report(manifest, find_reappeared(engine, manifest))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Verificación de reaparición de capturas ficticias purgadas"
    )
    parser.add_argument("--manifest", required=True, help="JSON con capturas purgadas")
    parser.add_argument("--restored-url", help="URL PostgreSQL de la copia aislada")
    parser.add_argument("--json", action="store_true", help="Emitir el reporte JSON")
    arguments = parser.parse_args(argv)
    engine = None
    try:
        environment = dict(os.environ)
        if arguments.restored_url:
            environment["RESTORED_DATABASE_URL"] = arguments.restored_url
        url = require_verification_environment(environment)
        manifest = load_manifest(arguments.manifest)
        engine = read_only_engine(url)
        report = verify_restored_copy(engine, manifest)
    except (RecoveryVerificationDenied, RecoveryVerificationError) as exc:
        print(str(exc), file=sys.stderr, flush=True)
        return 2
    except ValueError:
        print("Configuración de verificación no válida.", file=sys.stderr, flush=True)
        return 2
    finally:
        if engine is not None:
            engine.dispose()
    if arguments.json:
        print(json.dumps(report, ensure_ascii=False, sort_keys=True), flush=True)
    else:
        print(
            f"estado={report['status']} revisadas={report['checked_captures']} "
            f"reaparecidas={report['reappeared_count']} "
            f"borrado_global_verificado={report['global_verified_deletion']}",
            flush=True,
        )
        for identifier in report["reappeared"]:
            print(f"discrepancia.captura={identifier['id']}", flush=True)
    return 3 if report["status"] == STATUS_DISCREPANCY else 0


if __name__ == "__main__":
    raise SystemExit(main())
