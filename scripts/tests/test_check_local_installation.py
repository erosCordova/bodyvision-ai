"""Exercise actual local HTTP responses, including failures and leaked bodies."""

import contextlib
import importlib.util
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "check_local", ROOT / "scripts/check_local_installation.py"
)
doctor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(doctor)


@contextlib.contextmanager
def service(overrides=None):
    routes = {
        "/api/v1/health/live": (
            200,
            "application/json",
            json.dumps(
                {"status": "alive", "service": "bodyvision-api", "environment": "local"}
            ),
        ),
        "/api/v1/health/ready": (
            200,
            "application/json",
            json.dumps(
                {
                    "status": "ready",
                    "database": "connected",
                    "schema_revision": "test_revision",
                }
            ),
        ),
        "/": (
            200,
            "text/html",
            '<div id="root"></div><script type="module" src="/assets/app.js"></script>',
        ),
    }
    routes.update(overrides or {})

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            status, content_type, body = routes[self.path]
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            if status == 302:
                self.send_header("Location", "/")
            self.end_headers()
            self.wfile.write(body.encode())

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


class InstallationTests(unittest.TestCase):
    def test_checks_all_services_without_claiming_acceptance(self):
        with service() as url:
            report = doctor.check_installation(url, "test_revision")
        self.assertTrue(report["passed"])
        self.assertEqual(report["formalAcceptance"], "pending")
        self.assertEqual(len(report["checks"]), 3)

    def test_database_failure_is_actionable_and_body_is_never_exposed(self):
        with service(
            {"/api/v1/health/ready": (503, "application/json", "secret-token")}
        ) as url:
            report = doctor.check_installation(url, "test_revision")
        self.assertFalse(report["passed"])
        self.assertIn("Alembic", report["checks"][1]["detail"])
        self.assertNotIn("secret-token", json.dumps(report))
        self.assertEqual(report["checks"][2]["state"], "passed")

    def test_rejects_old_schema_fake_health_html_and_oversized_bodies(self):
        for response in [
            (
                200,
                "application/json",
                '{"status":"ready","database":"connected","schema_revision":"old"}',
            ),
            (200, "text/html", "<html>secret</html>"),
            (200, "application/json", "[]"),
            (200, "application/json", "x" * 65537),
            (302, "text/html", "secret"),
        ]:
            with (
                self.subTest(response=response[:2]),
                service({"/api/v1/health/ready": response}) as url,
            ):
                report = doctor.check_installation(url, "test_revision")
            self.assertFalse(report["passed"])
            self.assertNotIn("secret", json.dumps(report))

    def test_rejects_demo_environment_and_generic_html(self):
        with service(
            {
                "/api/v1/health/live": (
                    200,
                    "application/json",
                    json.dumps(
                        {
                            "status": "alive",
                            "service": "bodyvision-api",
                            "environment": "demo",
                        }
                    ),
                ),
                "/": (200, "text/html", "<h1>Proxy welcome</h1>"),
            }
        ) as url:
            report = doctor.check_installation(url, "test_revision")
        self.assertEqual(
            [check["state"] for check in report["checks"]],
            ["failed", "passed", "failed"],
        )

    def test_unavailable_server_is_not_success(self):
        with service() as url:
            pass
        self.assertFalse(
            doctor.check_installation(url, "test_revision", timeout=0.1)["passed"]
        )

    def test_only_loopback_urls_without_credentials_are_allowed(self):
        for url in [
            "https://example.com",
            "http://127.0.0.1.evil:8080",
            "http://user:secret@localhost:8080",
            "http://localhost:8080/path",
            "http://localhost:8080?token=x",
            "http://localhost:bad",
        ]:
            with (
                self.subTest(url=url),
                self.assertRaises(doctor.argparse.ArgumentTypeError),
            ):
                doctor.local_url(url)
        self.assertEqual(doctor.local_url("http://[::1]:8080/"), "http://[::1]:8080")

    def test_reads_schema_contract_without_backend_dependencies(self):
        schema = doctor.expected_schema(ROOT)
        self.assertRegex(schema, r"^\d{4}_")


if __name__ == "__main__":
    unittest.main()
