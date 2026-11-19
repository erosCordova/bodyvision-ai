"""Metadata-stripping PNG intake: positive and malformed fixtures."""

import struct
import zlib

import pytest

from app.core.errors import DomainError
from app.services.synthetic_capture_png import MAX_CAPTURE_BYTES, validate_synthetic_png


def chunk(name: bytes, content: bytes) -> bytes:
    payload = name + content
    return (
        struct.pack(">I", len(content))
        + payload
        + struct.pack(">I", zlib.crc32(payload) & 0xFFFFFFFF)
    )


def small_png(width: int = 32, height: int = 64) -> bytes:
    scan = bytes([0] + [100, 120, 140] * width) * height
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(scan))
        + chunk(b"IEND", b"")
    )


def test_accepts_minimal_rgb_png_without_metadata():
    image = small_png()
    assert len(image) >= 80
    assert validate_synthetic_png(image) == (32, 64)


@pytest.mark.parametrize(
    "image",
    [
        b"GIF89a" + b"0" * 80,
        small_png()[:-3],
        small_png() + b"trailer",
        small_png().replace(b"IDAT", b"abcd"),
        small_png().replace(b"IEND", b"IDAT"),
        small_png()[:35] + b"x" + small_png()[36:],
        small_png(1024, 1024),
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 32, 64, 8, 6, 0, 0, 1))
        + chunk(b"IDAT", zlib.compress(bytes([0] + [0] * 32 * 4) * 64))
        + chunk(b"IEND", b""),
    ],
)
def test_rejects_wrong_or_corrupt_png(image):
    with pytest.raises(DomainError):
        validate_synthetic_png(image)


def test_refuses_text_chunks_metadata_and_decompression_bomb():
    original = small_png()
    metadata = chunk(b"tEXt", b"patient\x00synthetic-bad-metadata")
    assert len(original) < MAX_CAPTURE_BYTES
    with pytest.raises(DomainError):
        validate_synthetic_png(original[:-12] + metadata + original[-12:])
    # Nominal header 16x16, but a compressed stream much larger than permitted.
    huge_rows = bytes([0] + [45, 67, 89] * 16) * 5000
    bomb = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 16, 16, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(huge_rows))
        + chunk(b"IEND", b"")
    )
    with pytest.raises(DomainError):
        validate_synthetic_png(bomb)
