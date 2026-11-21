"""Fail-closed integrity gate for PostgreSQL custom-format synthetic CI backups.

This is not an authenticated signature, backup encryption or a production tool.
No database connection, external network, secrets, record bodies or file paths in logs.
"""

import argparse
import hashlib
import hmac
import json
import os
import re
import stat
from collections.abc import Mapping
from pathlib import Path

MAX_DUMP_BYTES = 128 * 1024 * 1024
MAX_MANIFEST_BYTES = 2048
CHUNK_BYTES = 64 * 1024
MANIFEST_KEYS = frozenset({"event", "version", "scope", "format", "bytes", "sha256"})


class RestoreManifestRejected(ValueError):
    """A missing, unexpected, corrupted or unsafe synthetic backup."""


def require_ci_synthetic(environment: Mapping[str, str]) -> None:
    if (
        environment.get("APP_ENV") != "test"
        or environment.get("CI") != "true"
        or environment.get("BODYVISION_RESTORE_DRILL") != "synthetic-only"
    ):
        raise RestoreManifestRejected("Explicit disposable synthetic CI only")


def _read_regular_file(path: Path, limit: int):
    if path.is_symlink():
        raise RestoreManifestRejected("Symbolic link not permitted")
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise RestoreManifestRejected("Regular single-link file required")
    if info.st_size < 1 or info.st_size > limit:
        raise RestoreManifestRejected("File size outside permitted range")
    return info


def fingerprint(backup: Path) -> tuple[int, str]:
    # Open the exact inode we inspect. O_NOFOLLOW closes the check/open symlink
    # swap window on POSIX; the preflight check remains for Windows.
    _read_regular_file(backup, MAX_DUMP_BYTES)
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(backup, flags)
    with os.fdopen(descriptor, "rb") as content:
        metadata = os.fstat(content.fileno())
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_nlink != 1
            or not 5 <= metadata.st_size <= MAX_DUMP_BYTES
        ):
            raise RestoreManifestRejected("Regular single-link backup required")
        digest = hashlib.sha256()
        total = 0
        if content.read(5) != b"PGDMP":
            raise RestoreManifestRejected("Not PostgreSQL custom dump")
        digest.update(b"PGDMP")
        total += 5
        while chunk := content.read(CHUNK_BYTES):
            total += len(chunk)
            if total > MAX_DUMP_BYTES:
                raise RestoreManifestRejected("Backup exceeds limit")
            digest.update(chunk)
        after = os.fstat(content.fileno())
        if (
            total != metadata.st_size
            or after.st_size != metadata.st_size
            or after.st_mtime_ns != metadata.st_mtime_ns
            or after.st_ctime_ns != metadata.st_ctime_ns
        ):
            raise RestoreManifestRejected("Backup changed during read")
    return total, digest.hexdigest()


def build_manifest(backup: Path) -> dict[str, str | int]:
    size, digest = fingerprint(backup)
    return {
        "event": "synthetic_postgres_dump_manifest",
        "version": 1,
        "scope": "disposable_ci_only",
        "format": "pg_dump_custom",
        "bytes": size,
        "sha256": digest,
    }


def create_manifest(backup: Path, manifest: Path) -> None:
    record = build_manifest(backup)
    if manifest.is_symlink():
        raise RestoreManifestRejected("Manifest symlink not permitted")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(manifest, flags, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(record, stream, sort_keys=True, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        manifest.unlink(missing_ok=True)
        raise


def verify_manifest(backup: Path, manifest: Path) -> None:
    _read_regular_file(manifest, MAX_MANIFEST_BYTES)
    try:
        record = json.loads(manifest.read_text(encoding="utf-8"))
    except (ValueError, UnicodeError) as exc:
        raise RestoreManifestRejected("Malformed manifest") from exc
    if not isinstance(record, dict) or record.keys() != MANIFEST_KEYS:
        raise RestoreManifestRejected("Invalid manifest fields")
    if (
        record["event"] != "synthetic_postgres_dump_manifest"
        or type(record["version"]) is not int
        or record["version"] != 1
        or record["scope"] != "disposable_ci_only"
        or record["format"] != "pg_dump_custom"
        or type(record["bytes"]) is not int
        or not 5 <= record["bytes"] <= MAX_DUMP_BYTES
        or not isinstance(record["sha256"], str)
        or re.fullmatch(r"[a-f0-9]{64}", record["sha256"]) is None
    ):
        raise RestoreManifestRejected("Unexpected manifest schema")
    count, digest = fingerprint(backup)
    if count != record["bytes"] or not hmac.compare_digest(digest, record["sha256"]):
        raise RestoreManifestRejected("Dump checksum mismatch")


def main(argv: list[str] | None = None, environment: Mapping[str, str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Synthetic-only PostgreSQL restore gate")
    parser.add_argument("mode", choices=["create", "verify"])
    parser.add_argument("--backup", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        require_ci_synthetic(os.environ if environment is None else environment)
        if args.backup.resolve() == args.manifest.resolve():
            raise RestoreManifestRejected("Manifest must be separate")
        if args.mode == "create":
            create_manifest(args.backup, args.manifest)
        else:
            verify_manifest(args.backup, args.manifest)
    except (RestoreManifestRejected, OSError, ValueError):
        print('{"event":"synthetic_restore_integrity_rejected"}')
        return 2
    print(
        json.dumps(
            {
                "event": "synthetic_restore_integrity_gate",
                "status": "created" if args.mode == "create" else "verified",
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
