"""Bounded deterministic CSV for private fictional observed measurements.

No request-supplied values, notes, photos, simulations or names are exported.
The SHA-256 in the API response verifies only transfer integrity.
"""
import csv
import io
from datetime import UTC, datetime
from decimal import Decimal

MAX_LONGITUDINAL_ROWS = 500
HEADER = (
    "source_measurement_id", "measured_at_utc", "metric_code",
    "value", "unit", "method", "outlier_confirmed",
)


def _text_cell(value: object) -> str:
    value = str(value)
    # Prevent formula evaluation on opening in spreadsheet applications.
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@")) else value


def render_longitudinal_csv(rows: list[dict], metric_code: str, unit: str) -> bytes:
    if not 1 <= len(rows) <= MAX_LONGITUDINAL_ROWS:
        raise ValueError("La exportación requiere de 1 a 500 observaciones.")
    seen: set[str] = set()
    last_time: datetime | None = None
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(HEADER)
    for row in rows:
        source = str(row["id"])
        value = Decimal(str(row["value"]))
        measured_at = row["measured_at"]
        if (
            not source or source in seen or not value.is_finite()
            or not isinstance(measured_at, datetime) or measured_at.tzinfo is None
            or row["unit"] != unit or row["metric_code"] != metric_code
            or row["method"] not in {"manual", "device"}
            or not isinstance(row["outlier_confirmed"], bool)
        ):
            raise ValueError("Las fuentes longitudinales no son consistentes.")
        measured_utc = measured_at.astimezone(UTC)
        if last_time is not None and measured_utc < last_time:
            raise ValueError("Las fuentes no están ordenadas cronológicamente.")
        seen.add(source)
        last_time = measured_utc
        writer.writerow((
            _text_cell(source), measured_utc.isoformat().replace("+00:00", "Z"),
            _text_cell(metric_code), str(value), _text_cell(unit),
            _text_cell(row["method"]), "true" if row["outlier_confirmed"] else "false",
        ))
    return output.getvalue().encode("utf-8")
