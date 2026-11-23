"""Private, checked restore staging is mandatory for the disposable CI drill."""

import contextlib
import io
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import stage_verified_restore as stage
import verify_restore_manifest as manifest

ENV = {"APP_ENV": "test", "CI": "true", "BODYVISION_RESTORE_DRILL": "synthetic-only"}


class VerifiedRestoreStageTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.source = self.root / "original.dump"
        self.manifest = self.root / "integrity.json"
        self.private = self.root / "private"
        self.private.mkdir(mode=0o700)
        self.output = self.private / "verified.dump"
        self.sample = b"PGDMP" + b"entirely invented CI database" * 30
        self.source.write_bytes(self.sample)
        manifest.create_manifest(self.source, self.manifest)

    def test_stages_verified_copy_then_can_remove_original_and_restore_from_copy(self):
        stage.stage_verified_backup(self.source, self.manifest, self.output)
        self.assertEqual(self.output.read_bytes(), self.sample)
        self.source.unlink()
        manifest.verify_manifest(self.output, self.manifest)
        if os.name != "nt":
            self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o600)

    def test_changed_source_after_manifest_preflight_rejects_without_leaving_copy(self):
        original_open = os.open
        source_reads = 0

        def mutate_before_copy(path, flags, *args, **kwargs):
            nonlocal source_reads
            if Path(path) == self.source:
                source_reads += 1
                if source_reads == 2:
                    self.source.write_bytes(b"PGDMP" + b"falsified source" * 30)
            return original_open(path, flags, *args, **kwargs)

        with patch.object(stage.os, "open", side_effect=mutate_before_copy):
            with self.assertRaises(manifest.RestoreManifestRejected):
                stage.stage_verified_backup(self.source, self.manifest, self.output)
        self.assertEqual(source_reads, 2)
        self.assertFalse(self.output.exists())

    def test_tampered_manifest_or_source_is_rejected(self):
        self.source.write_bytes(self.sample + b"!")
        with self.assertRaises(manifest.RestoreManifestRejected):
            stage.stage_verified_backup(self.source, self.manifest, self.output)
        self.assertFalse(self.output.exists())

    def test_existing_destination_is_not_overwritten_or_removed(self):
        self.output.write_bytes(b"keep this existing private file")
        with self.assertRaises(FileExistsError):
            stage.stage_verified_backup(self.source, self.manifest, self.output)
        self.assertEqual(self.output.read_bytes(), b"keep this existing private file")

    @unittest.skipIf(os.name == "nt", "POSIX owner-only directory permissions")
    def test_rejects_public_staging_directory(self):
        self.private.chmod(0o755)
        with self.assertRaises(manifest.RestoreManifestRejected):
            stage.stage_verified_backup(self.source, self.manifest, self.output)
        self.assertFalse(self.output.exists())

    @unittest.skipUnless(
        hasattr(os, "mkfifo") and hasattr(os, "O_NONBLOCK"),
        "Requires a POSIX FIFO and nonblocking open",
    )
    def test_source_replaced_with_fifo_after_preflight_cannot_hang(self):
        original_open = os.open
        source_reads = 0

        def swap_before_copy(path, flags, *args, **kwargs):
            nonlocal source_reads
            if Path(path) == self.source:
                source_reads += 1
                if source_reads == 2:
                    self.source.rename(self.root / "quarantined.dump")
                    os.mkfifo(self.source)
            return original_open(path, flags, *args, **kwargs)

        with patch.object(stage.os, "open", side_effect=swap_before_copy):
            with self.assertRaises(manifest.RestoreManifestRejected):
                stage.stage_verified_backup(self.source, self.manifest, self.output)
        self.assertEqual(source_reads, 2)
        self.assertFalse(self.output.exists())

    def test_cli_requires_synthetic_ci_and_never_outputs_paths_or_bytes(self):
        args = [
            "--source", str(self.source),
            "--manifest", str(self.manifest),
            "--output", str(self.output),
        ]
        for environment, expected in (({}, 2), (ENV, 0)):
            with self.subTest(environment=environment):
                with patch.dict(os.environ, environment, clear=True):
                    buffer = io.StringIO()
                    with contextlib.redirect_stdout(buffer):
                        self.assertEqual(stage.main(args), expected)
                    logged = buffer.getvalue()
                    self.assertNotIn(str(self.source), logged)
                    self.assertNotIn("invented CI database", logged)
                    self.assertIn("synthetic_verified_backup_", logged)


if __name__ == "__main__":
    unittest.main()
