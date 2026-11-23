import copy
import hashlib
import json
from uuid import uuid4

import pytest

from app.core.audit_bundle import AuditBundleError, AuditCheckpoint, verify_audit_bundle


def bundle(count=2):
    organization = str(uuid4())
    events, prior = [], "0" * 64
    for position in range(1, count + 1):
        payload = json.dumps(
            [
                "bodyvision-audit-v1",
                position,
                prior,
                str(uuid4()),
                organization,
                None,
                str(uuid4()),
                "test.acción",
                "session",
                None,
                "allowed",
                "1795380000.123456",
            ],
            ensure_ascii=False,
        )
        digest = hashlib.sha256(payload.encode()).hexdigest()
        events.append(
            {"sequence": position, "previous_hash": prior, "event_hash": digest, "payload": payload}
        )
        prior = digest
    return {
        "version": 1,
        "algorithm": "sha256-chain-v1",
        "scope": "synthetic-organization-audit",
        "organization_id": organization,
        "export_id": str(uuid4()),
        "generated_at": "2026-11-22T19:00:00-05:00",
        "checkpoint_sequence": count,
        "checkpoint_hash": prior,
        "external_anchor": False,
        "events": events,
    }


def test_audit_bundle_empty_and_unicode_chain_have_verifiable_checkpoints():
    assert verify_audit_bundle(bundle(0)) == AuditCheckpoint(0, "0" * 64)
    source = bundle()
    assert verify_audit_bundle(source) == AuditCheckpoint(2, source["checkpoint_hash"])


@pytest.mark.parametrize(
    "change", ["payload", "order", "tail", "prior", "scope", "extra", "bool", "head"]
)
def test_changed_bytes_scope_order_missing_tail_and_extra_fields_are_rejected(change):
    source = bundle()
    if change == "payload":
        source["events"][0]["payload"] += " "
    elif change == "order":
        source["events"].reverse()
    elif change == "tail":
        source["events"].pop()
    elif change == "prior":
        source["events"][1]["previous_hash"] = "0" * 64
    elif change == "scope":
        source["organization_id"] = str(uuid4())
    elif change == "extra":
        source["patient_name"] = "Must never be exported"
    elif change == "bool":
        source["events"][0]["sequence"] = True
    elif change == "head":
        source["checkpoint_hash"] = "f" * 64
    with pytest.raises(AuditBundleError):
        verify_audit_bundle(source)


def test_independent_trusted_checkpoint_detects_self_consistent_truncation():
    source = bundle()
    checkpoint = verify_audit_bundle(source)
    truncated = copy.deepcopy(source)
    truncated["events"].pop()
    truncated["checkpoint_sequence"] = 1
    truncated["checkpoint_hash"] = truncated["events"][0]["event_hash"]
    # A file alone cannot establish its original authorship or original tail.
    assert verify_audit_bundle(truncated).sequence == 1
    with pytest.raises(AuditBundleError):
        verify_audit_bundle(truncated, checkpoint)


def test_malformed_payload_with_recomputed_digest_is_not_an_audit_event():
    source = bundle(1)
    row = source["events"][0]
    row["payload"] = "{}"
    row["event_hash"] = hashlib.sha256(b"{}").hexdigest()
    source["checkpoint_hash"] = row["event_hash"]
    with pytest.raises(AuditBundleError):
        verify_audit_bundle(source)
