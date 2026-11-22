"""Bounded deterministic CSV for private fictional observed measurements.

No request-supplied values, notes, photos, simulations or names are exported.
The SHA-256 in the API response verifies only transfer integrity.
"""

import csv
import io
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

MAX_LONGITUDINAL_BYTES = 8 * 1024 * 1024
HEADER = (
    "source_measurement_id",
    "measured_at_utc",
    "metric_code",
    "value",
    "unit",
    "method",
    "outlier_confirmed",
)


def _text_cell(value: object) -> str:
    value = str(value)
    # Prevent formula evaluation on opening in spreadsheet applications.
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@")) else value


class CsvSizeLimitError(ValueError):
    """No partial CSV may be returned when the byte budget is exhausted."""


class CsvUnitMismatchError(ValueError):
    """Stored sources must match the catalog unit before export."""


@dataclass(frozen=True)
class LongitudinalCsv:
    content: bytes
    row_count: int


def build_longitudinal_csv(rows: Iterable[Mapping], metric_code: str, unit: str) -> LongitudinalCsv:
    seen: set[str] = set()
    last_time: datetime | None = None
    row_buffer = io.StringIO(newline="")
    writer = csv.writer(row_buffer, lineterminator="\r\n")
    writer.writerow(HEADER)
    output = bytearray(row_buffer.getvalue().encode("utf-8"))
    count = 0
    for row in rows:
        row_buffer.seek(0)
        row_buffer.truncate()
        source = str(row["id"])
        value = Decimal(str(row["value"]))
        measured_at = row["measured_at"]
        if row["unit"] != unit:
            raise CsvUnitMismatchError("El historial contiene unidades distintas.")
        if (
            not source
            or source in seen
            or not value.is_finite()
            or not isinstance(measured_at, datetime)
            or measured_at.tzinfo is None
            or row["metric_code"] != metric_code
            or row["method"] not in {"manual", "device"}
            or not isinstance(row["outlier_confirmed"], bool)
        ):
            raise ValueError("Las fuentes longitudinales no son consistentes.")
        measured_utc = measured_at.astimezone(UTC)
        if last_time is not None and measured_utc < last_time:
            raise ValueError("Las fuentes no están ordenadas cronológicamente.")
        seen.add(source)
        last_time = measured_utc
        writer.writerow(
            (
                _text_cell(source),
                measured_utc.isoformat().replace("+00:00", "Z"),
                _text_cell(metric_code),
                str(value),
                _text_cell(unit),
                _text_cell(row["method"]),
                "true" if row["outlier_confirmed"] else "false",
            )
        )
        encoded = row_buffer.getvalue().encode("utf-8")
        if len(output) + len(encoded) > MAX_LONGITUDINAL_BYTES:
            raise CsvSizeLimitError("El CSV completo supera 8 MiB; selecciona un periodo menor.")
        output.extend(encoded)
        count += 1
    if not count:
        raise ValueError("La exportación requiere al menos una observación.")
    return LongitudinalCsv(bytes(output), count)


def render_longitudinal_csv(rows: Iterable[Mapping], metric_code: str, unit: str) -> bytes:
    return build_longitudinal_csv(rows, metric_code, unit).content
