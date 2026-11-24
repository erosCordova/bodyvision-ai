"""Offline verifier for detached fictional report receipts.

Run with the backend's installed dependencies; no database or network is used.
The key must be independently trusted, not supplied by the receipt.
"""

import argparse
import json
import os
import stat
from pathlib import Path

from app.services.report_signatures import PDF_LIMIT, ReportReceipt, verify_report_receipt

RECEIPT_LIMIT = 8192


def _bounded_read(path: Path, limit: int) -> bytes:
    if path.is_symlink():
        raise ValueError("Symbolic link not allowed")
    flags = (
        os.O_RDONLY
        | getattr(os, "O_BINARY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_NONBLOCK", 0)
    )
    with os.fdopen(os.open(path, flags), "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or not 1 <= before.st_size <= limit:
            raise ValueError("Unsafe receipt or report")
        data = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
        if (
            len(data) != before.st_size
            or len(data) > limit
            or before.st_size != after.st_size
            or before.st_mtime_ns != after.st_mtime_ns
            or before.st_ctime_ns != after.st_ctime_ns
        ):
            raise ValueError("File changed during verification")
        return data


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate receipt field")
        result[key] = value
    return result


def verify_files(report: Path, receipt_file: Path, trusted_key_file: Path) -> None:
    raw = _bounded_read(receipt_file, RECEIPT_LIMIT)
    payload = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object)
    if not isinstance(payload, dict) or set(payload) != set(ReportReceipt.model_fields):
        raise ValueError("Invalid receipt fields")
    receipt = ReportReceipt.model_validate(payload)
    key = _bounded_read(trusted_key_file, 32)
    if len(key) != 32:
        raise ValueError("Trusted key must contain exactly 32 raw Ed25519 public-key bytes")
    content = _bounded_read(report, PDF_LIMIT)
    verify_report_receipt(receipt, key, content, report.name)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify a fictional report against a trusted key")
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--trusted-public-key", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        verify_files(args.report, args.receipt, args.trusted_public_key)
    except (OSError, ValueError, RecursionError):
        print('{"event":"report_signature_rejected"}')
        return 2
    print('{"event":"report_signature_verified","scope":"synthetic-local-test-report"}')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
