"""Synthetic, bounded, permission-safe recovery observation tests."""

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "ci_recovery_timing", ROOT / "scripts/ci_recovery_timing.py"
)
timing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(timing)
ENV = {"APP_ENV": "test", "CI": "true", "BODYVISION_RESTORE_DRILL": "synthetic-only"}


class RecoveryTimingTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.state = Path(folder.name) / "timing.json"
        self.base = 10_000_000_000_000

    def mark(self, stage, seconds):
        timing.mark(self.state, stage, clock_ns=self.base + int(seconds * 1_000_000_000))

    def complete(self):
        for stage, seconds in zip(timing.STAGES, (0, 3, 8, 19, 31, 41), strict=True):
            self.mark(stage, seconds)
        return timing.report(timing.load(self.state))

    def test_complete_observation_is_non_sla_and_sanitized(self):
        result = self.complete()
        self.assertEqual(result["backup_to_private_http_seconds"], 19)
        self.assertEqual(result["primary_stop_to_private_http_seconds"], 16)
        self.assertEqual(result["primary_stop_to_browser_acceptance_seconds"], 28)
        self.assertEqual(result["private_http_to_browser_acceptance_seconds"], 12)
        self.assertEqual(result["browser_acceptance_to_original_ready_seconds"], 10)
        self.assertIsNone(result["rpo_seconds"])
        self.assertIsNone(result["rto_seconds"])
        self.assertFalse(result["service_level_approved"])
        self.assertFalse(result["production_ready"])
        self.assertNotIn("patient", json.dumps(result))
        if os.name != "nt":
            self.assertEqual(self.state.stat().st_mode & 0o777, 0o600)

    def test_missing_duplicate_and_out_of_order_stages_rejected(self):
        with self.assertRaises(timing.RecoveryTimingRejected):
            self.mark("primary_stopped", 1)
        self.mark("backup_captured", 0)
        for stage, seconds in (
            ("backup_captured", 1),
            ("restored_rows_verified", 1),
            ("primary_stopped", 0),
            ("primary_stopped", 7201),
        ):
            with self.subTest(stage=stage, seconds=seconds):
                with self.assertRaises(timing.RecoveryTimingRejected):
                    self.mark(stage, seconds)
        self.mark("primary_stopped", 2)

    def test_incomplete_report_and_absent_file_rejected(self):
        with self.assertRaises(OSError):
            timing.load(self.state)
        self.mark("backup_captured", 0)
        with self.assertRaises(timing.RecoveryTimingRejected):
            timing.report(timing.load(self.state))

    def test_corrupt_json_unexpected_keys_and_invalid_monotonic_clock_rejected(self):
        self.mark("backup_captured", 0)
        payload = json.loads(self.state.read_text(encoding="utf-8"))
        content = self.state.read_bytes()
        variants = (
            b"{",
            b"!" * (timing.MAX_BYTES + 1),
            json.dumps({**payload, "patient_name": "not allowed"}).encode(),
            json.dumps({**payload, "scope": "production"}).encode(),
            json.dumps({**payload, "version": True}).encode(),
            json.dumps({**payload, "samples": payload["samples"] * 2}).encode(),
            json.dumps({**payload, "samples": [
                {**payload["samples"][0], "monotonic_ns": True},
            ]}).encode(),
            content.strip()[:-1] + b',"scope":"disposable_ci_only"}',
        )
        for variant in variants:
            with self.subTest(variant=variant[:25]):
                self.state.write_bytes(variant)
                with self.assertRaises(timing.RecoveryTimingRejected):
                    timing.load(self.state)

    def test_hardlinks_symlinks_and_private_directory_are_required(self):
        self.mark("backup_captured", 0)
        linked = self.state.with_name("hardlink.json")
        os.link(self.state, linked)
        with self.assertRaises(timing.RecoveryTimingRejected):
            timing.load(self.state)
        linked.unlink()
        self.state.unlink()
        try:
            self.state.symlink_to(self.state.with_name("not-found.json"))
        except (OSError, NotImplementedError):
            pass
        else:
            with self.assertRaises(timing.RecoveryTimingRejected):
                timing.mark(self.state, timing.STAGES[0], clock_ns=self.base)
        if os.name != "nt":
            with tempfile.TemporaryDirectory() as parent:
                folder = Path(parent)
                folder.chmod(0o755)
                with self.assertRaises(timing.RecoveryTimingRejected):
                    timing.mark(folder / "measurement.json", timing.STAGES[0],
                                clock_ns=self.base)

    def test_ci_opt_in_and_failure_redacts_paths(self):
        timing.require_ci(ENV)
        for change in (
            {"APP_ENV": "production"},
            {"APP_ENV": "local"},
            {"CI": "false"},
            {"BODYVISION_RESTORE_DRILL": "production"},
        ):
            with self.subTest(change=change):
                with self.assertRaises(timing.RecoveryTimingRejected):
                    timing.require_ci({**ENV, **change})
        with patch("builtins.print") as output:
            status = timing.main(["report", "--state", str(self.state)], ENV)
        self.assertEqual(status, 2)
        self.assertEqual(output.call_args.args[0],
                         '{"event":"synthetic_recovery_timing_rejected"}')
        self.assertNotIn(str(self.state), str(output.call_args_list))


if __name__ == "__main__":
    unittest.main()
