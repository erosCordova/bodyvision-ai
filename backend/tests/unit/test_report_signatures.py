import json
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.services.report_signatures import sign_report, verify_report_receipt
from app.services.verify_report_receipt import main, verify_files


@pytest.mark.parametrize("format_name", ["pdf", "csv"])
def test_receipt_verifies_against_independent_key_and_rejects_tampering(format_name):
    private = Ed25519PrivateKey.generate()
    key = private.private_bytes_raw().hex()
    public = private.public_key().public_bytes_raw()
    identifier = uuid4()
    filename = (
        f"bodyvision-{identifier}.pdf"
        if format_name == "pdf"
        else f"bodyvision-historial-{identifier}.csv"
    )
    data = b"synthetic report test bytes"
    receipt = sign_report(
        key,
        format_name=format_name,
        export_id=identifier,
        filename=filename,
        generated_at=datetime.now(UTC),
        content=data,
        row_count=1 if format_name == "csv" else None,
    )
    verify_report_receipt(receipt, public, data, filename)
    for invalid_key, invalid_data, invalid_name in (
        (Ed25519PrivateKey.generate().public_key().public_bytes_raw(), data, filename),
        (public, data + b"changed", filename),
        (public, data, "other.pdf"),
    ):
        with pytest.raises(ValueError):
            verify_report_receipt(receipt, invalid_key, invalid_data, invalid_name)
    with pytest.raises(ValueError):
        verify_report_receipt(
            receipt.model_copy(update={"generated_at": "2026-01-01T00:00:00.000000Z"}),
            public,
            data,
            filename,
        )


def test_offline_cli_rejects_duplicate_fields_and_untrusted_key(tmp_path, capsys):
    private = Ed25519PrivateKey.generate()
    key = tmp_path / "public.key"
    key.write_bytes(private.public_key().public_bytes_raw())
    identifier = uuid4()
    report = tmp_path / f"bodyvision-{identifier}.pdf"
    report.write_bytes(b"fictional PDF")
    receipt = sign_report(
        private.private_bytes_raw().hex(),
        format_name="pdf",
        export_id=identifier,
        filename=report.name,
        generated_at=datetime.now(UTC),
        content=report.read_bytes(),
    )
    manifest = tmp_path / "receipt.json"
    manifest.write_text(receipt.model_dump_json(), encoding="utf-8")
    verify_files(report, manifest, key)
    args = [
        "--report",
        str(report),
        "--receipt",
        str(manifest),
        "--trusted-public-key",
        str(key),
    ]
    assert main(args) == 0
    assert json.loads(capsys.readouterr().out)["event"] == "report_signature_verified"
    manifest.write_text(receipt.model_dump_json()[:-1] + ',"version":1}', encoding="utf-8")
    assert main(args) == 2
    assert json.loads(capsys.readouterr().out) == {"event": "report_signature_rejected"}
    manifest.write_text(receipt.model_dump_json(), encoding="utf-8")
    key.write_bytes(Ed25519PrivateKey.generate().public_key().public_bytes_raw())
    assert main(args) == 2
    assert json.loads(capsys.readouterr().out) == {"event": "report_signature_rejected"}
