"""Contract checks for the optional Windows double-click launcher.

These tests inspect the source without invoking Docker, a browser, or real data.
End-to-end Windows/Docker acceptance remains a separate manual check.
"""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]
LAUNCHER = ROOT / "INICIAR_BODYVISION.cmd"


class WindowsLauncherContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = LAUNCHER.read_text(encoding="utf-8")
        cls.commands = [
            line.strip().lower()
            for line in cls.source.splitlines()
            if line.strip() and not line.lstrip().startswith("rem ")
        ]

    def test_uses_own_checkout_directory(self):
        self.assertIn('cd /d "%~dp0"', self.source.lower())

    def test_requires_existing_config_instead_of_overwriting_secrets(self):
        self.assertRegex(self.source.lower(), r'if not exist "\.env"')
        self.assertNotIn("setup_local.py", "\n".join(self.commands))

    def test_checks_docker_before_start(self):
        source = self.source.lower()
        self.assertLess(source.index("where docker"), source.index("docker compose up"))
        self.assertLess(source.index("docker info"), source.index("docker compose up"))
        self.assertIn("linux", source)

    def test_preserves_data_and_does_not_seed(self):
        all_commands = "\n".join(self.commands)
        self.assertNotRegex(all_commands, r"docker\s+compose\s+down\b")
        self.assertNotRegex(all_commands, r"docker\s+volume\s+(rm|prune)\b")
        self.assertNotRegex(all_commands, r"docker\s+compose\s+run\s+.*seed")
        self.assertNotIn("git reset", all_commands)

    def test_only_opens_ui_after_successful_health_verification(self):
        source = self.source.lower()
        self.assertIn("python scripts\\check_local_installation.py", source)
        self.assertIn('start "" "http://localhost:8080"', source)
        self.assertLess(
            source.index("python scripts\\check_local_installation.py"),
            source.index('start "" "http://localhost:8080"'),
        )
        self.assertRegex(
            source,
            r"python scripts\\check_local_installation\.py\s*\nif errorlevel 1",
        )

    def test_failure_is_visible_and_returns_nonzero(self):
        self.assertIn(":failed", self.source.lower())
        self.assertIn("pause", self.commands)
        self.assertIn("exit /b 1", self.commands)


if __name__ == "__main__":
    unittest.main()
