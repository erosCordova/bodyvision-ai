"""Fail-closed, dependency-free synthetic pg_dump manifest tests."""

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "restore_manifest", ROOT / "scripts/verify_restore_manifest.py"
)
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)
SAFE_ENV = {"APP_ENV": "test", "CI": "true", "BODYVISION_RESTORE_DRILL": "synthetic-only"}


class SyntheticRestoreManifestTests(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.folder = Path(self.work.name)
        self.backup = self.folder / "backup.dump"
        self.manifest = self.folder / "manifest.json"
        self.backup.write_bytes(b"PGDMP" + b"completely fictional records" * 9)

    def test_create_and_verify_roundtrip_without_exposing_records(self):
        restore.create_manifest(self.backup, self.manifest)
        restore.verify_manifest(self.backup, self.manifest)
        record = json.loads(self.manifest.read_text(encoding="utf-8"))
        self.assertEqual(record["format"], "pg_dump_custom")
        self.assertEqual(record["scope"], "disposable_ci_only")
        self.assertEqual(record["bytes"], self.backup.stat().st_size)
        self.assertEqual(len(record["sha256"]), 64)
        self.assertNotIn("fictional records", self.manifest.read_text())
        if os.name != "nt":
            self.assertEqual(self.manifest.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(FileExistsError):
            restore.create_manifest(self.backup, self.manifest)

    def test_corrupted_or_truncated_backup_is_rejected_before_restore(self):
        restore.create_manifest(self.backup, self.manifest)
        for modified in (b"PGDMP" + b"changed", b"PGDMP", b"NOTPG" + b"data"):
            with self.subTest(modified=modified):
                self.backup.write_bytes(modified)
                with self.assertRaises(restore.RestoreManifestRejected):
                    restore.verify_manifest(self.backup, self.manifest)

    def test_invalid_json_wrong_keys_and_manipulated_digest_are_rejected(self):
        restore.create_manifest(self.backup, self.manifest)
        original = json.loads(self.manifest.read_text())
        variants = (
            b"{",
            json.dumps({**original, "patient_id": "secret"}).encode(),
            json.dumps({**original, "scope": "production"}).encode(),
            json.dumps({**original, "bytes": True}).encode(),
            json.dumps({**original, "sha256": "0" * 64}).encode(),
            b"x" * (restore.MAX_MANIFEST_BYTES + 1),
        )
        for variant in variants:
            with self.subTest(variant=variant[:40]):
                self.manifest.write_bytes(variant)
                with self.assertRaises((restore.RestoreManifestRejected, ValueError)):
                    restore.verify_manifest(self.backup, self.manifest)

    def test_wrong_format_empty_and_symlink_are_rejected(self):
        for content in (b"", b"-- SQL plain dump", b"x" * (restore.MAX_DUMP_BYTES + 1)):
            with self.subTest(size=len(content)):
                self.backup.write_bytes(content)
                with self.assertRaises(restore.RestoreManifestRejected):
                    restore.build_manifest(self.backup)
        self.backup.write_bytes(b"PGDMP" + b"valid")
        link = self.folder / "link.dump"
        if hasattr(os, "symlink"):
            try:
                link.symlink_to(self.backup)
            except (OSError, NotImplementedError):
                return
            with self.assertRaises(restore.RestoreManifestRejected):
                restore.build_manifest(link)

    def test_requires_explicit_disposable_ci_opt_in(self):
        restore.require_ci_synthetic(SAFE_ENV)
        for change in (
            {"APP_ENV": "production"},
            {"APP_ENV": "local"},
            {"CI": "false"},
            {"BODYVISION_RESTORE_DRILL": "true"},
        ):
            with self.subTest(change=change):
                with self.assertRaises(restore.RestoreManifestRejected):
                    restore.require_ci_synthetic({**SAFE_ENV, **change})

    def test_cli_rejects_corruption_and_never_prints_sensitive_backup(self):
        arguments = ["create", "--backup", str(self.backup), "--manifest", str(self.manifest)]
        with patch("builtins.print") as log:
            self.assertEqual(restore.main(arguments, SAFE_ENV), 0)
        self.assertNotIn("fictional records", str(log.call_args_list))
        self.backup.write_bytes(b"PGDMP" + b"mutated fictional records")
        with patch("builtins.print") as log:
            self.assertEqual(restore.main(["verify", *arguments[1:]], SAFE_ENV), 2)
        self.assertEqual(str(log.call_args.args[0]), '{"event":"synthetic_restore_integrity_rejected"}')


if __name__ == "__main__":
    unittest.main()
