"""Data and sequence changes must fail the Docker preservation check."""

import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "verify_isolation", ROOT / "scripts/verify_test_isolation.py"
)
isolation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(isolation)


class PreservationTests(unittest.TestCase):
    def compare(self, before, after):
        with tempfile.TemporaryDirectory() as directory:
            first, second = (
                Path(directory) / "before.sql",
                Path(directory) / "after.sql",
            )
            first.write_bytes(before)
            second.write_bytes(after)
            return isolation.fingerprint(first) == isolation.fingerprint(second)

    def test_different_dump_restriction_keys_preserve_identical_records(self):
        data = b"COPY public.profiles (id, name) FROM stdin;\n1\tCaso ficticio\n\\.\n"
        self.assertTrue(
            self.compare(
                b"\\restrict key1\n" + data + b"\\unrestrict key1\n",
                b"\\restrict key2\n" + data + b"\\unrestrict key2\n",
            )
        )

    def test_record_changes_deletion_and_sequence_changes_are_detected(self):
        data = b"COPY public.profiles (id) FROM stdin;\n1\n\\.\n"
        self.assertFalse(self.compare(data, data.replace(b"\n1\n", b"\n2\n")))
        self.assertFalse(self.compare(data, data.replace(b"\n1\n", b"\n")))
        seq = b"SELECT pg_catalog.setval('public.seq', 10, true);\n"
        self.assertFalse(self.compare(data + seq, data + seq.replace(b"10", b"11")))

    def test_empty_or_error_output_does_not_certify_preservation(self):
        for value in [
            b"",
            b"pg_dump: error: connection failed\n",
            b"-- dump header only\n",
        ]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.compare(value, value)


if __name__ == "__main__":
    unittest.main()
