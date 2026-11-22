import csv
import io
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest

from app.services.longitudinal_csv import MAX_LONGITUDINAL_ROWS, render_longitudinal_csv


def source(*, days: int, value: str = "70", unit: str = "kg", method: str = "manual"):
    return {
        "id": uuid4(),
        "measured_at": datetime(2026, 11, 20, tzinfo=UTC) - timedelta(days=days),
        "metric_code": "weight",
        "value": Decimal(value),
        "unit": unit,
        "method": method,
        "outlier_confirmed": False,
    }


def test_csv_is_reproducible_ordered_and_preserves_original_ids():
    older, newer = source(days=30), source(days=1, value="77.25")
    exported = render_longitudinal_csv([older, newer], "weight", "kg")
    assert exported == render_longitudinal_csv([older, newer], "weight", "kg")
    rows = list(csv.DictReader(io.StringIO(exported.decode("utf-8"))))
    assert [row["source_measurement_id"] for row in rows] == [
        str(older["id"]),
        str(newer["id"]),
    ]
    assert [row["value"] for row in rows] == ["70", "77.25"]


def test_text_cells_cannot_trigger_spreadsheet_formula():
    row = source(days=1, unit="=1+1")
    csv_text = render_longitudinal_csv([row], "weight", "=1+1").decode()
    parsed = list(csv.DictReader(io.StringIO(csv_text)))[0]
    assert parsed["unit"] == "'=1+1"


@pytest.mark.parametrize(
    "rows,metric,unit",
    [
        ([], "weight", "kg"),
        ([source(days=1), source(days=1)], "weight", "kg"),
        ([source(days=1)], "height", "kg"),
        ([source(days=1)], "weight", "cm"),
        ([source(days=1, value="NaN")], "weight", "kg"),
        ([source(days=1, method="fake")], "weight", "kg"),
        ([source(days=1, value="Infinity")], "weight", "kg"),
        ([source(days=1), source(days=30)], "weight", "kg"),
    ],
)
def test_csv_rejects_inconsistent_sources(rows, metric, unit):
    with pytest.raises(ValueError):
        render_longitudinal_csv(rows, metric, unit)


def test_csv_does_not_silently_truncate_more_than_500_sources():
    rows = [
        source(days=MAX_LONGITUDINAL_ROWS + 1 - index)
        for index in range(MAX_LONGITUDINAL_ROWS + 1)
    ]
    with pytest.raises(ValueError):
        render_longitudinal_csv(rows, "weight", "kg")
