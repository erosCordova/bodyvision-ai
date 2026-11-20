from datetime import UTC, datetime
from decimal import Decimal

from app.services.comparison_pdf import comparison_pdf


def test_pdf_offsets_spanish_escaping_and_change():
    pdf = comparison_pdf(
        report_id="fictional-report",
        profile_code="SEC-01",
        metric_label="Peso (revisión) \\ prueba\nFin",
        unit="kg",
        generated_at=datetime(2026, 11, 20, 18, tzinfo=UTC),
        initial={
            "id": "source-1",
            "value": Decimal("70"),
            "measured_at": datetime(2026, 10, 1, tzinfo=UTC),
        },
        final={
            "id": "source-2",
            "value": Decimal("77"),
            "measured_at": datetime(2026, 11, 1, tzinfo=UTC),
        },
    )
    assert b"+7 kg" in pdf and b"+10.00 %" in pdf
    assert b"20/11/2026 13:00:00" in pdf
    assert b"Peso \\(revisi\xf3n\\) \\\\ prueba Fin" in pdf
    assert b"source-1" in pdf and b"source-2" in pdf
    start = int(pdf.split(b"startxref\n")[1].splitlines()[0])
    assert pdf[start:].startswith(b"xref\n0 6\n")
    for index, entry in enumerate(pdf[start:].splitlines()[3:8], 1):
        offset = int(entry.split()[0])
        assert pdf[offset:].startswith(f"{index} 0 obj".encode())
    assert pdf.endswith(b"%%EOF\n")
