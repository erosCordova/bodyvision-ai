"""Small, deterministic A4 PDF with bounded literal text and no active content."""

from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo


def _literal(value: str) -> bytes:
    # WinAnsiEncoding supports Spanish. Controls and PDF syntax cannot become commands.
    safe = "".join(char if char.isprintable() else " " for char in value)
    return (
        safe.encode("cp1252", errors="replace")
        .replace(b"\\", b"\\\\")
        .replace(b"(", b"\\(")
        .replace(b")", b"\\)")
    )


def comparison_pdf(
    *,
    report_id: str,
    profile_code: str,
    metric_label: str,
    unit: str,
    generated_at: datetime,
    initial: dict,
    final: dict,
) -> bytes:
    first, last = Decimal(str(initial["value"])), Decimal(str(final["value"]))
    delta = last - first
    percent = f"{delta / first * 100:+.2f} %" if first else "No calculable (base cero)"

    def local(date: datetime) -> str:
        return date.astimezone(ZoneInfo("America/Lima")).strftime("%d/%m/%Y %H:%M:%S")

    lines = [
        "BODYVISION AI - Informe de comparación",
        "DATOS FICTICIOS - OBSERVADO",
        f"Informe: {report_id}",
        f"Generado (Lima): {local(generated_at)}",
        f"Expediente: {profile_code}",
        f"Métrica: {metric_label} ({unit})",
        "",
        f"Inicial: {first} {unit} - {local(initial['measured_at'])}",
        f"Fuente inicial: {initial['id']}",
        f"Final: {last} {unit} - {local(final['measured_at'])}",
        f"Fuente final: {final['id']}",
        "",
        f"Variación absoluta: {delta:+} {unit}",
        f"Variación relativa: {percent}",
        "",
        "Fuentes vigentes en la consulta de la fecha de generación.",
        "Las correcciones posteriores pueden sustituir estas fuentes.",
        "Solo describe dos observaciones; no incluye simulaciones 3D.",
        "No constituye diagnóstico ni predicción médica.",
        "Exportación registrada en la auditoría privada.",
        "PDF sin firma digital. La huella SHA-256 verifica integridad, no autoría.",
    ]
    stream = (
        b"BT /F1 11 Tf 48 790 Td 22 TL\n"
        + b"\n".join(b"(" + _literal(line[:100]) + b") Tj T*" for line in lines)
        + b"\nET"
    )
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    document = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(document))
        document.extend(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
    start = len(document)
    document.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        document.extend(f"{offset:010d} 00000 n \n".encode())
    document.extend(
        f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode()
    )
    return bytes(document)
