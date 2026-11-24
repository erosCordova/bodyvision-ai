"""Independent verification of exported audit bytes, never proof of authorship."""

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime

MAX_AUDIT_EVENTS = 10_000
MAX_AUDIT_BYTES = 8 * 1024 * 1024
UUID_TEXT = re.compile(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}")
DIGEST = re.compile(r"[0-9a-f]{64}")
FIELDS = {
    "version",
    "algorithm",
    "scope",
    "organization_id",
    "export_id",
    "generated_at",
    "checkpoint_sequence",
    "checkpoint_hash",
    "external_anchor",
    "events",
}


class AuditBundleError(ValueError):
    pass


@dataclass(frozen=True)
class AuditCheckpoint:
    sequence: int
    digest: str


def _uuid(value: object) -> bool:
    return isinstance(value, str) and UUID_TEXT.fullmatch(value) is not None


def verify_audit_bundle(value: object, expected: AuditCheckpoint | None = None) -> AuditCheckpoint:
    """Check structure, every event, contiguous chain, final head and optional anchor."""
    if not isinstance(value, dict) or set(value) != FIELDS:
        raise AuditBundleError("Invalid audit bundle fields")
    count, final_hash, events = (
        value["checkpoint_sequence"],
        value["checkpoint_hash"],
        value["events"],
    )
    if (
        type(value["version"]) is not int
        or value["version"] != 1
        or value["algorithm"] != "sha256-chain-v1"
        or value["scope"] != "synthetic-organization-audit"
        or value["external_anchor"] is not False
        or not _uuid(value["organization_id"])
        or not _uuid(value["export_id"])
        or type(count) is not int
        or not 0 <= count <= MAX_AUDIT_EVENTS
        or not isinstance(final_hash, str)
        or DIGEST.fullmatch(final_hash) is None
        or not isinstance(events, list)
        or len(events) != count
    ):
        raise AuditBundleError("Invalid audit bundle contract")
    try:
        timestamp = value["generated_at"]
        if not isinstance(timestamp, str) or len(timestamp) > 40:
            raise ValueError
        if datetime.fromisoformat(timestamp).tzinfo is None:
            raise ValueError
    except (ValueError, TypeError) as exc:
        raise AuditBundleError("Invalid audit timestamp") from exc
    prior = "0" * 64
    for position, event in enumerate(events, 1):
        if not isinstance(event, dict) or set(event) != {
            "sequence",
            "previous_hash",
            "event_hash",
            "payload",
        }:
            raise AuditBundleError("Invalid audit event fields")
        payload, digest = event["payload"], event["event_hash"]
        if (
            type(event["sequence"]) is not int
            or event["sequence"] != position
            or event["previous_hash"] != prior
            or not isinstance(payload, str)
            or len(payload) > 2048
            or not isinstance(digest, str)
            or DIGEST.fullmatch(digest) is None
            or hashlib.sha256(payload.encode("utf-8")).hexdigest() != digest
        ):
            raise AuditBundleError("Audit chain bytes do not match")
        try:
            data = json.loads(payload)
        except (ValueError, TypeError, RecursionError) as exc:
            raise AuditBundleError("Invalid audit event payload") from exc
        if (
            not isinstance(data, list)
            or len(data) != 12
            or data[0] != "bodyvision-audit-v1"
            or type(data[1]) is not int
            or data[1] != position
            or data[2] != prior
            or not _uuid(data[3])
            or data[4] != value["organization_id"]
            or (data[5] is not None and not _uuid(data[5]))
            or not _uuid(data[6])
            or not isinstance(data[7], str)
            or not 1 <= len(data[7]) <= 100
            or not isinstance(data[8], str)
            or not 1 <= len(data[8]) <= 60
            or (data[9] is not None and not _uuid(data[9]))
            or data[10] not in ("allowed", "denied", "error")
            or not isinstance(data[11], str)
            or re.fullmatch(r"-?\d{1,20}(?:\.\d{1,6})?", data[11]) is None
        ):
            raise AuditBundleError("Audit payload does not match its scope")
        prior = digest
    checkpoint = AuditCheckpoint(count, final_hash)
    if prior != final_hash or (expected is not None and checkpoint != expected):
        raise AuditBundleError("Audit checkpoint does not match")
    return checkpoint
