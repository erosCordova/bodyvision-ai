"""Read-only local startup check; Python standard library only, no credentials."""

import argparse
import ast
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, build_opener


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class AppShell(HTMLParser):
    def __init__(self):
        super().__init__()
        self.root = False
        self.module = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.root |= tag == "div" and attrs.get("id") == "root"
        self.module |= (
            tag == "script" and attrs.get("type") == "module" and bool(attrs.get("src"))
        )


def local_url(value):
    try:
        url = urlsplit(value)
        port = url.port
        if (
            url.scheme == "http"
            and url.hostname in {"127.0.0.1", "localhost", "::1"}
            and not url.username
            and not url.password
            and not url.query
            and not url.fragment
            and url.path in {"", "/"}
            and port
        ):
            return value.rstrip("/")
    except ValueError:
        pass
    raise argparse.ArgumentTypeError(
        "Usa http://127.0.0.1:8080 o una dirección loopback con puerto."
    )


def expected_schema(root):
    """Read the API's literal contract without importing SQLAlchemy or settings."""
    tree = ast.parse((root / "backend/app/db/session.py").read_text(encoding="utf-8"))
    for statement in tree.body:
        if isinstance(statement, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "SCHEMA_REVISION"
            for target in statement.targets
        ):
            value = ast.literal_eval(statement.value)
            if isinstance(value, str) and value:
                return value
    raise ValueError("Missing schema contract")


def check_installation(base_url, schema, timeout=5):
    opener = build_opener(ProxyHandler({}), NoRedirects())
    checks = []
    for name, path in [
        ("api", "/api/v1/health/live"),
        ("database", "/api/v1/health/ready"),
        ("frontend", "/"),
    ]:
        state = "failed"
        detail = "Respuesta incompatible; revisa la versión y configuración local."
        try:
            with opener.open(base_url + path, timeout=timeout) as response:
                content_type = response.headers.get_content_type()
                body = response.read(65537)
                if len(body) > 65536:
                    raise ValueError("Response too large")
                if name == "frontend":
                    shell = AppShell()
                    shell.feed(body.decode("utf-8"))
                    passed = content_type == "text/html" and shell.root and shell.module
                else:
                    data = json.loads(body)
                    if not isinstance(data, dict):
                        raise ValueError("Expected object")
                    if name == "api":
                        passed = (
                            content_type == "application/json"
                            and data.get("status") == "alive"
                            and data.get("service") == "bodyvision-api"
                            and data.get("environment") in {"local", "test"}
                        )
                    else:
                        passed = (
                            content_type == "application/json"
                            and data.get("status") == "ready"
                            and data.get("database") == "connected"
                            and data.get("schema_revision") == schema
                        )
                if passed:
                    state, detail = "passed", "Comprobado mediante HTTP local."
        except HTTPError as error:
            detail = (
                "Base o migraciones no disponibles; revisa PostgreSQL y Alembic."
                if name == "database" and error.code == 503
                else "Error HTTP; revisa el servicio y el proxy local."
            )
        except (OSError, URLError, TimeoutError):
            detail = "Servicio inaccesible; revisa el arranque y el puerto local."
        except (ValueError, UnicodeError):
            detail = "Respuesta inválida; revisa el servicio y el proxy local."
        checks.append({"id": name, "state": state, "detail": detail})
    return {
        "version": 1,
        "scope": "local-synthetic-startup",
        "passed": all(check["state"] == "passed" for check in checks),
        "formalAcceptance": "pending",
        "checks": checks,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Comprueba API, esquema SQL e interfaz local sin modificar datos."
    )
    parser.add_argument("--base-url", type=local_url, default="http://127.0.0.1:8080")
    parser.add_argument(
        "--json",
        action="store_true",
        help="Salida JSON sin respuestas ni credenciales.",
    )
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    try:
        schema = expected_schema(root)
    except (OSError, ValueError, SyntaxError):
        parser.exit(1, "No se pudo leer el contrato de esquema del checkout local.\n")
    report = check_installation(args.base_url, schema)
    if args.json:
        print(json.dumps(report, ensure_ascii=False))
    else:
        for check in report["checks"]:
            print(f"{check['id']}: {check['state']} — {check['detail']}")
        print(
            "Arranque comprobado."
            if report["passed"]
            else "Instalación incompleta; revisa los controles fallidos."
        )
        print("Esta comprobación no sustituye la recepción operativa de F1.")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
