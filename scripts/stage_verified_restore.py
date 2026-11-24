"""Pin a checked synthetic PGDMP as a private copy for the CI restore drill.

The manifest SHA-256 is checked against the COPY that pg_restore consumes.
No production, external services, personal data, or credentials are allowed.
"""

import argparse
import json
import os
import stat
from pathlib import Path

from verify_restore_manifest import (
    CHUNK_BYTES,
    MAX_DUMP_BYTES,
    RestoreManifestRejected,
    require_ci_synthetic,
    verify_manifest,
)


def _private_directory(folder: Path) -> None:
    if folder.is_symlink():
        raise RestoreManifestRejected("Private staging directory cannot be a symlink")
    info = folder.stat()
    if not stat.S_ISDIR(info.st_mode):
        raise RestoreManifestRejected("Private staging directory required")
    if os.name != "nt":
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise RestoreManifestRejected("Private staging directory requires owner-only access")


def stage_verified_backup(source: Path, manifest: Path, output: Path) -> None:
    """Copy, then recheck the exact private file used for both CI restores."""
    _private_directory(output.parent)
    if source.is_symlink():
        raise RestoreManifestRejected("Source symlink is not permitted")
    # Preflight source + manifest, rejecting a corrupt backup early.
    verify_manifest(source, manifest)
    source_flags = os.O_RDONLY | getattr(os, "O_BINARY", 0)
    source_flags |= getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    destination_flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    destination_flags |= getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)

    created = False
    try:
        with os.fdopen(os.open(source, source_flags), "rb") as original:
            before = os.fstat(original.fileno())
            if (
                not stat.S_ISREG(before.st_mode)
                or before.st_nlink != 1
                or not 5 <= before.st_size <= MAX_DUMP_BYTES
            ):
                raise RestoreManifestRejected("Unsafe backup source")
            descriptor = os.open(output, destination_flags, 0o600)
            created = True
            with os.fdopen(descriptor, "wb") as staged:
                count = 0
                while chunk := original.read(CHUNK_BYTES):
                    count += len(chunk)
                    if count > MAX_DUMP_BYTES:
                        raise RestoreManifestRejected("Backup exceeds CI size limit")
                    staged.write(chunk)
                staged.flush()
                os.fsync(staged.fileno())
            after = os.fstat(original.fileno())
            if (
                count != before.st_size
                or after.st_size != before.st_size
                or after.st_mtime_ns != before.st_mtime_ns
                or after.st_ctime_ns != before.st_ctime_ns
            ):
                raise RestoreManifestRejected("Backup source changed while copying")
        # No destination is consumed by pg_restore until its OWN bytes match
        # the independent manifest, not merely the previous source pathname.
        verify_manifest(output, manifest)
    except BaseException:
        if created:
            output.unlink(missing_ok=True)
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Stage synthetic checked backup for isolated CI")
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        require_ci_synthetic(os.environ)
        stage_verified_backup(args.source, args.manifest, args.output)
    except (RestoreManifestRejected, OSError, ValueError):
        print('{"event":"synthetic_verified_backup_stage_rejected"}')
        return 2
    print(json.dumps({"event": "synthetic_verified_backup_staged"}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
