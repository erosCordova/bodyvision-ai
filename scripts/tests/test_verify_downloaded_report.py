"""Portable tests for verification of saved, fictional BODYVISION exports."""

import hashlib
import importlib.util
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import UUID

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "saved_report_gate", ROOT / "scripts/verify_downloaded_report.py"
)
reports = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reports)

PDF_ID = UUID("11111111-2222-4333-8444-555555555555")
CSV_ID = UUID("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")
SOURCE_1 = "aaaa0000-0000-4000-8000-000000000001"
SOURCE_2 = "aaaa0000-0000-4000-8000-000000000002"


class SavedReportTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = Path(folder.name)
        self.pdf = self.folder / f"bodyvision-{PDF_ID}.pdf"
        self.csv = self.folder / f"bodyvision-historial-{CSV_ID}.csv"
        self.pdf_bytes = b"%PDF-1.4\n%fictional report\nxref\n%%EOF\n"
        self.csv_bytes = (
            ",".join(reports.CSV_COLUMNS) + "\r\n"
            + f"{SOURCE_1},2026-11-01T10:00:00Z,weight,72,kg,manual,false\r\n"
            + f"{SOURCE_2},2026-11-02T10:00:00Z,weight,71,kg,manual,true\r\n"
        ).encode("utf-8")
        self.pdf.write_bytes(self.pdf_bytes)
        self.csv.write_bytes(self.csv_bytes)

    @staticmethod
    def digest(payload):
        return hashlib.sha256(payload).hexdigest()

    def check_pdf(self, **changes):
        inputs = {
            "expected_sha256": self.digest(self.pdf_bytes),
            "export_id": PDF_ID,
            "format_name": "pdf",
        }
        inputs.update(changes)
        return reports.verify_saved_report(self.pdf, **inputs)

    def check_csv(self, **changes):
        inputs = {
            "expected_sha256": self.digest(self.csv_bytes),
            "export_id": CSV_ID,
            "format_name": "csv",
            "expected_rows": 2,
        }
        inputs.update(changes)
        return reports.verify_saved_report(self.csv, **inputs)

    def test_valid_saved_pdf_and_csv(self):
        self.assertIsNone(self.check_pdf())
        self.assertEqual(self.check_csv(), 2)

    def test_one_byte_corruption_rejected(self):
        self.pdf.write_bytes(self.pdf_bytes.replace(b"fictional", b"Fictional"))
        self.csv.write_bytes(self.csv_bytes.replace(b"72,kg", b"73,kg"))
        with self.assertRaises(reports.DownloadRejected):
            self.check_pdf()
        with self.assertRaises(reports.DownloadRejected):
            self.check_csv()

    def test_format_envelopes_and_truncation(self):
        wrong_pdf = b"NOT PDF\n%%EOF\n"
        wrong_csv = b"source_measurement_id,not_the_right_schema\r\n"
        self.pdf.write_bytes(wrong_pdf)
        self.csv.write_bytes(wrong_csv)
        with self.assertRaises(reports.DownloadRejected):
            self.check_pdf(expected_sha256=self.digest(wrong_pdf))
        with self.assertRaises(reports.DownloadRejected):
            self.check_csv(expected_sha256=self.digest(wrong_csv))

    def test_id_filename_and_expected_digest_required(self):
        with self.assertRaises(reports.DownloadRejected):
            self.check_pdf(export_id=CSV_ID)
        with self.assertRaises(reports.DownloadRejected):
            self.check_csv(export_id=PDF_ID)
        for digest in ("bad", "A" * 64, "0" * 64):
            with self.subTest(digest=digest):
                with self.assertRaises(reports.DownloadRejected):
                    self.check_pdf(expected_sha256=digest)

    def test_csv_row_count_duplicate_and_invalid_values(self):
        with self.assertRaises(reports.DownloadRejected):
            self.check_csv(expected_rows=1)
        with self.assertRaises(reports.DownloadRejected):
            self.check_csv(expected_rows=3)
        with self.assertRaises(reports.DownloadRejected):
            self.check_csv(expected_rows=True)
        duplicate = self.csv_bytes.replace(SOURCE_2.encode(), SOURCE_1.encode())
        self.csv.write_bytes(duplicate)
        with self.assertRaises(reports.DownloadRejected):
            self.check_csv(expected_sha256=self.digest(duplicate))
        bad_method = self.csv_bytes.replace(b",manual,true", b",auto,true")
        self.csv.write_bytes(bad_method)
        with self.assertRaises(reports.DownloadRejected):
            self.check_csv(expected_sha256=self.digest(bad_method))

    def test_rejects_symlinks_hardlinks_and_oversized_files(self):
        hardlink = self.folder / "hardlink.pdf"
        os.link(self.pdf, hardlink)
        with self.assertRaises(reports.DownloadRejected):
            self.check_pdf()
        hardlink.unlink()
        if hasattr(os, "symlink"):
            link = self.folder / "symbolic.pdf"
            try:
                link.symlink_to(self.pdf)
            except (OSError, NotImplementedError):
                pass
            else:
                self.pdf.rename(self.folder / "original.pdf")
                link.rename(self.pdf)
                with self.assertRaises(reports.DownloadRejected):
                    self.check_pdf()
                self.pdf.unlink()
        with self.csv.open("wb") as writer:
            writer.truncate(reports.CSV_MAX_BYTES + 1)
        with self.assertRaises(reports.DownloadRejected):
            self.check_csv()

    def test_cli_emits_only_generic_status_not_sensitive_bytes(self):
        args = [
            "--file", str(self.csv),
            "--sha256", self.digest(self.csv_bytes),
            "--export-id", str(CSV_ID),
            "--format", "csv",
            "--rows", "2",
        ]
        with patch("builtins.print") as log:
            self.assertEqual(reports.main(args), 0)
        self.assertIn("downloaded_report_verified", str(log.call_args))
        self.assertNotIn(SOURCE_1, str(log.call_args))
        self.csv.write_bytes(b"fictional but altered")
        with patch("builtins.print") as log:
            self.assertEqual(reports.main(args), 2)
        self.assertEqual(log.call_args.args[0], '{"event":"downloaded_report_rejected"}')

    def test_csv_invalid_utf8_and_pdf_rows_rejected(self):
        corrupted = self.csv_bytes + b"\xff"
        self.csv.write_bytes(corrupted)
        with self.assertRaises(reports.DownloadRejected):
            self.check_csv(expected_sha256=self.digest(corrupted))
        with self.assertRaises(reports.DownloadRejected):
            self.check_pdf(expected_rows=2)


if __name__ == "__main__":
    unittest.main()
