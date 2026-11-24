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
            (self.manifest.read_text().strip()[:-1] + ',"sha256":"' + original["sha256"] + '"}').encode(),
            b"x" * (restore.MAX_MANIFEST_BYTES + 1),
        )
        for variant in variants:
            with self.subTest(variant=variant[:40]):
                self.manifest.write_bytes(variant)
                with self.assertRaises((restore.RestoreManifestRejected, ValueError)):
                    restore.verify_manifest(self.backup, self.manifest)

    def test_wrong_format_empty_and_symlink_are_rejected(self):
        for content in (b"", b"-- SQL plain dump"):
            with self.subTest(size=len(content)):
                self.backup.write_bytes(content)
                with self.assertRaises(restore.RestoreManifestRejected):
                    restore.build_manifest(self.backup)
        # Sparse file exercises the bound without allocating 128 MiB of RAM.
        with self.backup.open("wb") as output:
            output.truncate(restore.MAX_DUMP_BYTES + 1)
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

    def test_rejects_hardlinked_backup_and_manifest(self):
        other = self.folder / "linked.dump"
        os.link(self.backup, other)
        with self.assertRaises(restore.RestoreManifestRejected):
            restore.fingerprint(self.backup)
        other.unlink()
        restore.create_manifest(self.backup, self.manifest)
        manifest_link = self.folder / "linked.json"
        os.link(self.manifest, manifest_link)
        with self.assertRaises(restore.RestoreManifestRejected):
            restore.verify_manifest(self.backup, self.manifest)

    def test_detects_manifest_mutation_during_streaming(self):
        restore.create_manifest(self.backup, self.manifest)
        original_fstat = os.fstat
        calls = 0

        def mutate_before_final_stat(descriptor):
            nonlocal calls
            calls += 1
            if calls == 2:
                with self.manifest.open("r+b") as output:
                    output.seek(10)
                    output.write(b"CHANGED")
            return original_fstat(descriptor)

        with patch.object(restore.os, "fstat", side_effect=mutate_before_final_stat):
            with self.assertRaises(restore.RestoreManifestRejected):
                restore.verify_manifest(self.backup, self.manifest)

    def test_detects_backup_mutation_during_streaming(self):
        original_fstat = os.fstat
        calls = 0

        def mutate_before_final_stat(descriptor):
            nonlocal calls
            calls += 1
            if calls == 2:
                # Make the concurrent mutation observable on NTFS as well as
                # POSIX. A same-length write may not advance filesystem time
                # metadata within the Windows runner's timestamp window.
                with self.backup.open("r+b") as output:
                    output.seek(7)
                    output.write(b"CHANGED")
                    output.seek(0, os.SEEK_END)
                    output.write(b"!")
            return original_fstat(descriptor)

        with patch.object(restore.os, "fstat", side_effect=mutate_before_final_stat):
            with self.assertRaises(restore.RestoreManifestRejected):
                restore.fingerprint(self.backup)

    @unittest.skipUnless(
        hasattr(os, "mkfifo") and hasattr(os, "O_NONBLOCK"),
        "POSIX FIFO and nonblocking file open required",
    )
    def test_replaced_regular_backup_cannot_block_on_fifo_open(self):
        # The initial stat sees a regular file. Swap the path immediately
        # before os.open: the open must not wait for a FIFO writer.
        original_open = os.open
        swapped = False

        def swap_after_preflight(path, flags, *args, **kwargs):
            nonlocal swapped
            if not swapped and Path(path) == self.backup:
                swapped = True
                self.backup.rename(self.folder / "quarantined.dump")
                os.mkfifo(self.backup)
            return original_open(path, flags, *args, **kwargs)

        with patch.object(restore.os, "open", side_effect=swap_after_preflight):
            with self.assertRaises(restore.RestoreManifestRejected):
                restore.fingerprint(self.backup)
        self.assertTrue(swapped)

    @unittest.skipUnless(
        hasattr(os, "mkfifo") and hasattr(os, "O_NONBLOCK"),
        "POSIX FIFO and nonblocking file open required",
    )
    def test_replaced_regular_manifest_cannot_block_on_fifo_open(self):
        restore.create_manifest(self.backup, self.manifest)
        original_open = os.open
        swapped = False

        def swap_after_preflight(path, flags, *args, **kwargs):
            nonlocal swapped
            if not swapped and Path(path) == self.manifest:
                swapped = True
                self.manifest.rename(self.folder / "quarantined.json")
                os.mkfifo(self.manifest)
            return original_open(path, flags, *args, **kwargs)

        with patch.object(restore.os, "open", side_effect=swap_after_preflight):
            with self.assertRaises(restore.RestoreManifestRejected):
                restore.verify_manifest(self.backup, self.manifest)
        self.assertTrue(swapped)

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
