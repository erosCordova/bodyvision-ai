"""Compare local synthetic SQL snapshots without printing their contents."""

import argparse
import hashlib
from pathlib import Path


def fingerprint(path):
    digest = hashlib.sha256()
    has_data = False
    with path.open("rb") as snapshot:
        for line in snapshot:
            # Recent pg_dump versions randomize psql's restriction key per dump.
            # These two command lines contain no records or sequence state.
            if line.startswith((b"\\restrict ", b"\\unrestrict ")):
                continue
            has_data |= line.startswith(
                (b"COPY ", b"INSERT INTO ", b"SELECT pg_catalog.setval(")
            )
            digest.update(line)
    if not has_data:
        raise ValueError("Snapshot contains no synthetic data")
    return digest.digest()


def main():
    parser = argparse.ArgumentParser(
        description="Verifica que las pruebas no cambien la base local."
    )
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    args = parser.parse_args()
    try:
        unchanged = fingerprint(args.before) == fingerprint(args.after)
    except (OSError, ValueError):
        print("No se pudieron verificar las dos copias SQL con datos ficticios.")
        return 1
    print(
        "Datos locales intactos tras las pruebas."
        if unchanged
        else "La base local cambió durante las pruebas; revisar el aislamiento."
    )
    return 0 if unchanged else 1


if __name__ == "__main__":
    raise SystemExit(main())
