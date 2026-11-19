"""Strict PNG-only synthetic capture ingest: no EXIF, text chunks or covert metadata.

The private preview is intentionally not a general-purpose patient upload.
Only non-interlaced 8-bit RGB/RGBA PNGs with IHDR/IDAT/IEND are accepted.
Compressed scanlines are validated with a bounded decompressor.
"""

import struct
import zlib

from app.core.errors import DomainError

MAX_CAPTURE_BYTES = 262_144
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def validate_synthetic_png(payload: bytes) -> tuple[int, int]:
    if len(payload) < 80 or len(payload) > MAX_CAPTURE_BYTES:
        raise DomainError(413, "CAPTURE_SIZE", "El PNG ficticio debe ocupar entre 80 B y 256 KiB.")
    if not payload.startswith(PNG_SIGNATURE):
        raise DomainError(422, "INVALID_PNG", "Se requiere un PNG válido sin metadatos.")
    position = len(PNG_SIGNATURE)
    found_ihdr = False
    found_iend = False
    collected_idat = bytearray()
    idat_started = False
    idat_finished = False
    width = height = channels = 0
    while position < len(payload):
        if position + 12 > len(payload):
            raise DomainError(422, "INVALID_PNG", "Estructura PNG incompleta.")
        chunk_size = struct.unpack_from(">I", payload, position)[0]
        chunk_name = payload[position + 4 : position + 8]
        end = position + 12 + chunk_size
        if end > len(payload):
            raise DomainError(422, "INVALID_PNG", "Estructura PNG incompleta.")
        contents = payload[position + 8 : end - 4]
        supplied_crc = struct.unpack_from(">I", payload, end - 4)[0]
        expected_crc = zlib.crc32(contents, zlib.crc32(chunk_name)) & 0xFFFFFFFF
        if supplied_crc != expected_crc:
            raise DomainError(422, "INVALID_PNG", "El PNG no supera la comprobación de integridad.")
        position = end

        if chunk_name == b"IHDR" and not found_ihdr and not idat_started:
            if chunk_size != 13:
                raise DomainError(422, "INVALID_PNG", "Encabezado PNG inválido.")
            width, height, depth, color, compression, filtering, interlace = struct.unpack(
                ">IIBBBBB", contents
            )
            if not (
                1 <= width <= 1024
                and 1 <= height <= 1024
                and width * height <= 1_000_000
                and depth == 8
                and color in (2, 6)
                and compression == filtering == interlace == 0
            ):
                raise DomainError(422, "INVALID_PNG", "PNG fuera del formato de prueba permitido.")
            channels = 3 if color == 2 else 4
            found_ihdr = True
        elif chunk_name == b"IDAT" and found_ihdr and not idat_finished:
            idat_started = True
            collected_idat.extend(contents)
        elif chunk_name == b"IEND" and found_ihdr and idat_started:
            if chunk_size or position != len(payload):
                raise DomainError(422, "INVALID_PNG", "Fin de PNG inválido.")
            found_iend = True
            break
        else:
            # No ancillary chunks, text, color profiles, EXIF, animations or
            # extra data. This limits metadata leakage in fictitious tests.
            raise DomainError(422, "INVALID_PNG", "Se rechazaron metadatos o bloques PNG.")
        if idat_started and chunk_name != b"IDAT":
            idat_finished = True

    if not found_iend or not collected_idat:
        raise DomainError(422, "INVALID_PNG", "PNG sin datos completos.")
    expected_size = height * (width * channels + 1)
    decoder = zlib.decompressobj()
    try:
        raw = decoder.decompress(bytes(collected_idat), expected_size + 1)
        raw += decoder.flush(expected_size + 1 - len(raw))
    except zlib.error as exc:
        raise DomainError(422, "INVALID_PNG", "PNG comprimido inválido.") from exc
    if len(raw) != expected_size or not decoder.eof or decoder.unused_data:
        raise DomainError(422, "INVALID_PNG", "Contenido PNG inconsistente.")
    stride = width * channels + 1
    if any(raw[offset] > 4 for offset in range(0, len(raw), stride)):
        raise DomainError(422, "INVALID_PNG", "Filtro PNG inválido.")
    return width, height
