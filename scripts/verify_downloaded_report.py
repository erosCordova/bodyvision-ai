"""Offline integrity check for a BODYVISION fictional report saved to disk.

The SHA-256 and export ID must come from the trusted API response, separately
from the downloaded file. This does NOT prove authorship, a digital signature,
external audit anchoring, or durable filesystem persistence.
"""

import argparse
import csv
import hashlib
import hmac
import io
import json
import os
import re
import stat
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from uuid import UUID

CSV_MAX_BYTES = 8 * 1024 * 1024
PDF_MAX_BYTES = 16 * 1024 * 1024
CHUNK_BYTES = 64 * 1024
CSV_COLUMNS = (
    "source_measurement_id",
    "measured_at_utc",
    "metric_code",
    "value",
    "unit",
    "method",
    "outlier_confirmed",
)


class DownloadRejected(ValueError):
    """An unverifiable or inconsistent saved report."""


def _validate_csv(content: bytes, expected_rows: int) -> int:
    try:
        decoded = content.decode("utf-8")
        if "\x00" in decoded:
            raise DownloadRejected("CSV contains invalid null characters")
        reader = csv.reader(io.StringIO(decoded, newline=""), strict=True)
        if tuple(next(reader, ())) != CSV_COLUMNS:
            raise DownloadRejected("Unexpected CSV header")
        seen: set[UUID] = set()
        first_metric: str | None = None
        first_unit: str | None = None
        previous_key: tuple[datetime, str] | None = None
        count = 0
        for row in reader:
            if len(row) != len(CSV_COLUMNS):
                raise DownloadRejected("Malformed CSV record")
            try:
                source = UUID(row[0])
                value = Decimal(row[3])
                if not re.fullmatch(
                    r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z",
                    row[1],
                ):
                    raise DownloadRejected("Invalid UTC timestamp")
                moment = datetime.fromisoformat(row[1].replace("Z", "+00:00"))
            except (ValueError, AttributeError, InvalidOperation) as exc:
                raise DownloadRejected("Invalid CSV field") from exc
            key = (moment.astimezone(UTC), str(source))
            if (
                str(source) != row[0]
                or source in seen
                or not value.is_finite()
                or not row[2]
                or not row[4]
                or row[5] not in {"manual", "device"}
                or row[6] not in {"true", "false"}
                or (first_metric is not None and row[2] != first_metric)
                or (first_unit is not None and row[4] != first_unit)
                or (previous_key is not None and key <= previous_key)
            ):
                raise DownloadRejected("Inconsistent CSV record")
            seen.add(source)
            first_metric = row[2]
            first_unit = row[4]
            previous_key = key
            count += 1
            if count > expected_rows:
                raise DownloadRejected("Unexpected CSV row count")
        if count != expected_rows or count < 1:
            raise DownloadRejected("Unexpected CSV row count")
        return count
    except (UnicodeError, csv.Error) as exc:
        raise DownloadRejected("Invalid CSV encoding or syntax") from exc


def verify_saved_report(
    path: Path,
    *,
    expected_sha256: str,
    export_id: UUID,
    format_name: str,
    expected_rows: int | None = None,
) -> int | None:
    """Check the exact saved bytes against API metadata, without contacting a server."""
    if format_name not in {"pdf", "csv"}:
        raise DownloadRejected("Unsupported format")
    if not isinstance(expected_sha256, str) or re.fullmatch(
        r"[0-9a-f]{64}", expected_sha256
    ) is None:
        raise DownloadRejected("Invalid expected digest")
    if format_name == "pdf":
        if expected_rows is not None:
            raise DownloadRejected("Row count belongs to CSV only")
        expected_filename = f"bodyvision-{export_id}.pdf"
        limit = PDF_MAX_BYTES
    else:
        if type(expected_rows) is not int or not 1 <= expected_rows <= 100_000:
            raise DownloadRejected("Valid CSV row count required")
        expected_filename = f"bodyvision-historial-{export_id}.csv"
        limit = CSV_MAX_BYTES
    if path.name != expected_filename or path.is_symlink():
        raise DownloadRejected("Unexpected report name or symbolic link")
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or not 1 <= before.st_size <= limit
        ):
            raise DownloadRejected("Unsafe report file")
        digest = hashlib.sha256()
        content = bytearray() if format_name == "csv" else None
        head = b""
        tail = b""
        total = 0
        while chunk := stream.read(CHUNK_BYTES):
            if not head:
                head = chunk[:16]
            tail = (tail + chunk)[-32:]
            total += len(chunk)
            if total > limit:
                raise DownloadRejected("Report exceeds format limit")
            digest.update(chunk)
            if content is not None:
                content.extend(chunk)
        after = os.fstat(stream.fileno())
        if (
            total != before.st_size
            or after.st_size != before.st_size
            or after.st_mtime_ns != before.st_mtime_ns
            or after.st_ctime_ns != before.st_ctime_ns
        ):
            raise DownloadRejected("Report changed during verification")
    if not hmac.compare_digest(digest.hexdigest(), expected_sha256):
        raise DownloadRejected("Saved report SHA-256 mismatch")
    if format_name == "pdf":
        if not head.startswith(b"%PDF-") or not tail.rstrip().endswith(b"%%EOF"):
            raise DownloadRejected("Invalid PDF envelope")
        return None
    return _validate_csv(bytes(content), expected_rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify a saved fictional BODYVISION report")
    parser.add_argument("--file", required=True, type=Path)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--export-id", required=True)
    parser.add_argument("--format", choices=("pdf", "csv"), required=True)
    parser.add_argument("--rows", type=int)
    args = parser.parse_args(argv)
    try:
        identifier = UUID(args.export_id)
        count = verify_saved_report(
            args.file,
            expected_sha256=args.sha256,
            export_id=identifier,
            format_name=args.format,
            expected_rows=args.rows,
        )
    except (ValueError, OSError):
        print('{"event":"downloaded_report_rejected"}')
        return 2
    record = {"event": "downloaded_report_verified", "format": args.format}
    if count is not None:
        record["rows"] = count
    print(json.dumps(record, separators=(",", ":"), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
