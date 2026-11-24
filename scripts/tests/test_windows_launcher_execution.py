"""Windows-only failure-path execution tests for the local launcher.

Uses disposable temp directories and fake executables; no Docker is started.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "INICIAR_BODYVISION.cmd"


@unittest.skipUnless(os.name == "nt", "Windows cmd.exe only")
class WindowsLauncherFailureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="bodyvision-launcher-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "fake-bin"
        self.bin.mkdir()
        self.checkout = self.root / "checkout"
        self.checkout.mkdir()
        shutil.copyfile(SOURCE, self.checkout / SOURCE.name)
        self.env = os.environ.copy()
        self.env["PATH"] = str(self.bin) + os.pathsep + self.env.get("PATH", "")

    def run_launcher(self):
        return subprocess.run(
            ["cmd.exe", "/d", "/c", str(self.checkout / SOURCE.name)],
            cwd=self.checkout,
            input="\n",
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=25,
            env=self.env,
            check=False,
        )

    def fake_docker(self):
        (self.bin / "docker.cmd").write_text(
            '@echo off\n'
            'if /i "%~1"=="info" (\n'
            '  echo linux\n'
            '  exit /b 0\n'
            ')\n'
            'echo docker-compose-called>>"%~dp0calls.txt"\n'
            'exit /b 0\n',
            encoding="ascii",
        )

    def test_missing_env_stops_before_compose(self):
        self.fake_docker()
        outcome = self.run_launcher()
        self.assertNotEqual(outcome.returncode, 0)
        self.assertIn("Falta .env", outcome.stdout)
        self.assertFalse((self.bin / "calls.txt").exists())

    def test_failed_python_check_does_not_modify_env_or_open_browser(self):
        self.fake_docker()
        config = self.checkout / ".env"
        config.write_bytes(b"COMPOSE_PROJECT_NAME=bodyvision-test\nKEEP=unchanged\n")
        (self.bin / "python.cmd").write_text(
            '@echo off\n'
            'echo verification-called>>"%~dp0checks.txt"\n'
            'exit /b 1\n',
            encoding="ascii",
        )
        outcome = self.run_launcher()
        self.assertNotEqual(outcome.returncode, 0)
        self.assertIn("comprobacion del entorno local", outcome.stdout)
        self.assertEqual(
            config.read_bytes(),
            b"COMPOSE_PROJECT_NAME=bodyvision-test\nKEEP=unchanged\n",
        )
        self.assertTrue((self.bin / "calls.txt").exists())
        self.assertTrue((self.bin / "checks.txt").exists())
        self.assertNotIn("Abriendo http://localhost:8080", outcome.stdout)


if __name__ == "__main__":
    unittest.main()
