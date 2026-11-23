"""Compare restored synthetic PostgreSQL DATA, not unstable pg_dump text order.

PostgreSQL dumps of the same rows may differ in row order and comments
across independent clusters. This script compares full row multisets
(including duplicates), COPY headers, INSERTs and sequence states.
The stricter same-database preservation check remains unchanged.
"""

import argparse
import hashlib
import json
import os
import re
import stat
from pathlib import Path

MAX_SQL_BYTES = 128 * 1024 * 1024
MAX_ROWS = 1_000_000


class RestoredDataRejected(ValueError):
    """The dump is missing, malformed, unsupported or incomplete."""


def _sections(path: Path) -> tuple[dict[bytes, list[bytes]], list[bytes]]:
    if path.is_symlink():
        raise RestoredDataRejected("Symlinks not permitted")
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not 0 < info.st_size <= MAX_SQL_BYTES:
        raise RestoredDataRejected("Invalid dump size or file type")

    copies: dict[bytes, list[bytes]] = {}
    statements: list[bytes] = []
    current: list[bytes] | None = None
    rows = 0
    bytes_read = 0

    # Path preflight alone is not enough: an attacker can swap a dump for
    # a FIFO before os.open(). Never block waiting for a writer; fstat
    # rejects every non-regular descriptor before data is processed.
    flags = (
        os.O_RDONLY
        | getattr(os, "O_BINARY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_NONBLOCK", 0)
    )
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, "rb") as source:
        before = os.fstat(source.fileno())
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or not 0 < before.st_size <= MAX_SQL_BYTES
        ):
            raise RestoredDataRejected("Invalid open dump")
        for raw in source:
            bytes_read += len(raw)
            if bytes_read > MAX_SQL_BYTES:
                raise RestoredDataRejected("Dump exceeds size limit")
            line = raw.rstrip(b"\r\n")
            if current is not None:
                if line == b"\\.":
                    current = None
                else:
                    rows += 1
                    if rows > MAX_ROWS:
                        raise RestoredDataRejected("Too many synthetic rows")
                    current.append(hashlib.sha256(line).digest())
                continue
            if line.startswith(b"COPY "):
                if not line.endswith(b" FROM stdin;") or line in copies:
                    raise RestoredDataRejected("Invalid COPY section")
                current = []
                copies[line] = current
            elif line.startswith((b"SELECT pg_catalog.setval(", b"INSERT INTO ")):
                if not line.endswith(b";"):
                    raise RestoredDataRejected("Invalid data statement")
                statements.append(line)
            elif (
                not line
                or line.startswith(b"--")
                or line.startswith(b"SET ")
                or line.startswith(b"SELECT pg_catalog.set_config(")
                or line.startswith(b"\\restrict ")
                or line.startswith(b"\\unrestrict ")
            ):
                # Ordinary pg_dump data-only session setup and metadata.
                continue
            else:
                # Never silently exclude unfamiliar SQL or psql commands.
                raise RestoredDataRejected("Unexpected SQL or metadata")
        after = os.fstat(source.fileno())
        if (
            after.st_size != before.st_size
            or after.st_mtime_ns != before.st_mtime_ns
            or after.st_ctime_ns != before.st_ctime_ns
            or bytes_read != before.st_size
        ):
            raise RestoredDataRejected("Dump changed during reading")
    if current is not None:
        raise RestoredDataRejected("Incomplete COPY block")
    if not copies and not statements:
        raise RestoredDataRejected("No synthetic data sections")
    return copies, statements


def fingerprint(path: Path) -> bytes:
    copies, statements = _sections(path)
    digest = hashlib.sha256()
    for header, records in sorted(copies.items()):
        digest.update(b"\x01")
        digest.update(len(header).to_bytes(4, "big"))
        digest.update(header)
        digest.update(len(records).to_bytes(8, "big"))
        for row_hash in sorted(records):
            digest.update(row_hash)
    for statement in sorted(statements):
        digest.update(b"\x02")
        digest.update(len(statement).to_bytes(4, "big"))
        digest.update(statement)
    return digest.digest()


def discrepancy_summary(left: Path, right: Path) -> dict[str, object]:
    """Only schema section NAMES/counts; never SQL rows, IDs or values."""
    left_copies, left_statements = _sections(left)
    right_copies, right_statements = _sections(right)
    different = []
    for header in set(left_copies) | set(right_copies):
        first = left_copies.get(header)
        second = right_copies.get(header)
        if first is None or second is None or sorted(first) != sorted(second):
            match = re.fullmatch(rb"COPY (public\.[a-z_][a-z0-9_]*) \(.*\) FROM stdin;", header)
            different.append(match.group(1).decode("ascii") if match else "unrecognized_section")
    return {
        "different_tables": sorted(different)[:12],
        "different_table_count": len(different),
        "data_statement_mismatch": sorted(left_statements) != sorted(right_statements),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Synthetic isolated restore comparison")
    parser.add_argument("original", type=Path)
    parser.add_argument("restored", type=Path)
    args = parser.parse_args(argv)
    try:
        same = fingerprint(args.original) == fingerprint(args.restored)
    except (OSError, RestoredDataRejected):
        print('{"event":"synthetic_recovery_data_unverifiable"}')
        return 2
    if not same:
        summary = discrepancy_summary(args.original, args.restored)
        print(json.dumps({"event": "synthetic_recovery_data_mismatch", **summary}, sort_keys=True))
        return 1
    print('{"event":"synthetic_recovery_data_verified"}')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
