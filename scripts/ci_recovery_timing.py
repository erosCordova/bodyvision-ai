"""Observe milestones of a disposable synthetic recovery, not production RPO/RTO.

No SQL, personal records, URLs, passwords or tokens are written or logged.
"""

import argparse
import json
import os
import stat
import tempfile
import time
from collections.abc import Mapping
from pathlib import Path

STAGES = (
    "backup_captured",
    "primary_stopped",
    "restored_rows_verified",
    "private_http_ready",
    "private_browser_verified",
    "primary_stack_recovered",
)
MAX_BYTES = 4096
MAX_DURATION_NS = 7200 * 1_000_000_000


class RecoveryTimingRejected(ValueError):
    """Refuse incomplete, manipulated or unscoped timing evidence."""


def require_ci(environment: Mapping[str, str]) -> None:
    if (
        environment.get("APP_ENV") != "test"
        or environment.get("CI") != "true"
        or environment.get("BODYVISION_RESTORE_DRILL") != "synthetic-only"
    ):
        raise RecoveryTimingRejected("Disposable synthetic CI only")


def unique_fields(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise RecoveryTimingRejected("Duplicate field")
        result[key] = value
    return result


def ensure_private_path(path: Path) -> None:
    if (
        not path.parent.is_dir()
        or path.parent.is_symlink()
        or (os.name != "nt" and path.parent.stat().st_mode & 0o077)
        or path.is_symlink()
    ):
        raise RecoveryTimingRejected("Private temporary directory and regular state required")


def validate(data: object) -> list[dict[str, str | int]]:
    if (
        not isinstance(data, dict)
        or set(data) != {"version", "scope", "samples"}
        or type(data["version"]) is not int
        or data["version"] != 1
        or data["scope"] != "disposable_ci_only"
        or not isinstance(data["samples"], list)
        or not 1 <= len(data["samples"]) <= len(STAGES)
    ):
        raise RecoveryTimingRejected("Invalid timing evidence")
    samples = data["samples"]
    previous = None
    first = None
    for index, item in enumerate(samples):
        if (
            not isinstance(item, dict)
            or set(item) != {"stage", "monotonic_ns"}
            or item["stage"] != STAGES[index]
            or type(item["monotonic_ns"]) is not int
            or item["monotonic_ns"] <= 0
        ):
            raise RecoveryTimingRejected("Invalid timing evidence")
        current = item["monotonic_ns"]
        if first is None:
            first = current
        if previous is not None and current <= previous:
            raise RecoveryTimingRejected("Nonmonotonic milestones")
        if current - first > MAX_DURATION_NS:
            raise RecoveryTimingRejected("Stale timing evidence")
        previous = current
    return samples


def load(path: Path) -> list[dict[str, str | int]]:
    ensure_private_path(path)
    descriptor = os.open(
        path, os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    )
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or not 1 <= before.st_size <= MAX_BYTES
        ):
            raise RecoveryTimingRejected("Unsafe timing file")
        contents = stream.read(MAX_BYTES + 1)
        after = os.fstat(stream.fileno())
        fingerprint = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        if (
            len(contents) != before.st_size
            or len(contents) > MAX_BYTES
            or fingerprint(before) != fingerprint(after)
        ):
            raise RecoveryTimingRejected("Timing file changed during read")
    try:
        return validate(json.loads(contents.decode("utf-8"), object_pairs_hook=unique_fields))
    except (ValueError, UnicodeError):
        raise RecoveryTimingRejected("Invalid timing evidence") from None


def save(path: Path, samples: list[dict[str, str | int]]) -> None:
    ensure_private_path(path)
    validate({"version": 1, "scope": "disposable_ci_only", "samples": samples})
    temporary = None
    try:
        descriptor, temporary = tempfile.mkstemp(prefix=".bodyvision-time-", dir=path.parent)
        if hasattr(os, "fchmod"):
            os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(
                {"version": 1, "scope": "disposable_ci_only", "samples": samples},
                stream, sort_keys=True, separators=(",", ":")
            )
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        if Path(temporary).stat().st_size > MAX_BYTES:
            raise RecoveryTimingRejected("Timing state exceeds limit")
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            Path(temporary).unlink(missing_ok=True)


def mark(path: Path, stage: str, *, clock_ns: int | None = None) -> None:
    ensure_private_path(path)
    samples = load(path) if path.exists() else []
    if len(samples) >= len(STAGES) or stage != STAGES[len(samples)]:
        raise RecoveryTimingRejected("Out-of-order milestone")
    now = time.monotonic_ns() if clock_ns is None else clock_ns
    if type(now) is not int or now <= 0:
        raise RecoveryTimingRejected("Invalid clock")
    if samples and (
        now <= samples[-1]["monotonic_ns"]
        or now - samples[0]["monotonic_ns"] > MAX_DURATION_NS
    ):
        raise RecoveryTimingRejected("Invalid milestone time")
    save(path, [*samples, {"stage": stage, "monotonic_ns": now}])


def report(samples: list[dict[str, str | int]]) -> dict[str, object]:
    validate({"version": 1, "scope": "disposable_ci_only", "samples": samples})
    if len(samples) != len(STAGES):
        raise RecoveryTimingRejected("Incomplete timing observation")
    points = {sample["stage"]: sample["monotonic_ns"] for sample in samples}

    def elapsed(start: str, end: str) -> float:
        return round((points[end] - points[start]) / 1_000_000_000, 3)

    return {
        "event": "synthetic_ci_recovery_observation",
        "scope": "disposable_ci_only",
        "status": "observed",
        "backup_to_private_http_seconds": elapsed("backup_captured", "private_http_ready"),
        "primary_stop_to_private_http_seconds": elapsed("primary_stopped", "private_http_ready"),
        "primary_stop_to_browser_acceptance_seconds": elapsed(
            "primary_stopped", "private_browser_verified"
        ),
        "private_http_to_browser_acceptance_seconds": elapsed(
            "private_http_ready", "private_browser_verified"
        ),
        "browser_acceptance_to_original_ready_seconds": elapsed(
            "private_browser_verified", "primary_stack_recovered"
        ),
        "rpo_seconds": None,
        "rto_seconds": None,
        "external_backup_verified": False,
        "service_level_approved": False,
        "production_ready": False,
    }


def main(argv: list[str] | None = None, environment: Mapping[str, str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Synthetic CI recovery timing only")
    parser.add_argument("mode", choices=("mark", "report"))
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--stage", choices=STAGES)
    args = parser.parse_args(argv)
    try:
        require_ci(os.environ if environment is None else environment)
        if args.mode == "mark":
            if args.stage is None:
                raise RecoveryTimingRejected("Missing stage")
            mark(args.state, args.stage)
            output = {"event": "synthetic_recovery_stage", "stage": args.stage}
        else:
            if args.stage is not None:
                raise RecoveryTimingRejected("Unexpected stage")
            output = report(load(args.state))
    except (RecoveryTimingRejected, OSError, TypeError, UnicodeError):
        print('{"event":"synthetic_recovery_timing_rejected"}')
        return 2
    print(json.dumps(output, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
