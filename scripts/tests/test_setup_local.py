"""Run the documented setup command in disposable checkouts, including Windows."""

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.checkout = Path(self.directory.name) / "BodyVision con espacios"
        (self.checkout / "scripts").mkdir(parents=True)
        shutil.copyfile(
            ROOT / "scripts/setup_local.py", self.checkout / "scripts/setup_local.py"
        )
        shutil.copyfile(ROOT / ".env.example", self.checkout / ".env.example")

    def run_setup(self):
        return subprocess.run(
            [sys.executable, "scripts/setup_local.py"],
            cwd=self.checkout,
            capture_output=True,
            check=False,
            timeout=15,
        )

    def test_generates_consistent_credentials_without_printing_secrets(self):
        result = self.run_setup()
        self.assertEqual(result.returncode, 0)
        content = (self.checkout / ".env").read_text(encoding="utf-8")
        values = dict(
            line.split("=", 1)
            for line in content.splitlines()
            if line and not line.startswith("#")
        )
        admin, app = values["POSTGRES_PASSWORD"], values["POSTGRES_APP_PASSWORD"]
        self.assertRegex(admin, r"^[0-9a-f]{64}$")
        self.assertRegex(app, r"^[0-9a-f]{64}$")
        self.assertNotEqual(admin, app)
        self.assertIn("postgres:" + admin + "@db:", values["MIGRATION_DATABASE_URL"])
        self.assertIn("bodyvision_app:" + app + "@db:", values["DATABASE_URL"])
        self.assertNotIn("GENERATED_BY_SETUP", content)
        for secret in [admin, app]:
            self.assertNotIn(secret.encode(), result.stdout + result.stderr)

    def test_repeat_keeps_existing_configuration_byte_for_byte(self):
        existing = self.checkout / ".env"
        existing.write_bytes(
            b"# Configuracion existente\r\nDO_NOT_REPLACE=existing-secret\r\n"
        )
        before = existing.read_bytes()
        result = self.run_setup()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(existing.read_bytes(), before)
        self.assertNotIn(b"existing-secret", result.stdout + result.stderr)

    def test_crlf_template_with_unicode_produces_utf8_lf_in_path_with_spaces(self):
        template = self.checkout / ".env.example"
        content = (
            template.read_text(encoding="utf-8")
            + "# Configuración — solo datos ficticios\n"
        )
        template.write_bytes(content.replace("\n", "\r\n").encode("utf-8"))
        result = self.run_setup()
        self.assertEqual(result.returncode, 0)
        generated = (self.checkout / ".env").read_bytes()
        self.assertNotIn(b"\r", generated)
        self.assertIn(
            "# Configuración — solo datos ficticios\n", generated.decode("utf-8")
        )


if __name__ == "__main__":
    unittest.main()
