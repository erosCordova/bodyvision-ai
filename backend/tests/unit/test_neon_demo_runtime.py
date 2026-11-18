"""Hosted demo is strictly an API process attached to external Neon."""
import os
import sys

from app import demo_runtime


def test_demo_runtime_rejects_local_and_render_postgres(monkeypatch, capsys):
    monkeypatch.setenv("APP_ENV", "demo")
    monkeypatch.setenv("PORT", "10000")
    for database in [
        "postgresql+psycopg://user:secret@127.0.0.1:5432/bodyvision?sslmode=require",
        "postgresql+psycopg://user:secret@db.render.com/bodyvision?sslmode=require",
        "postgresql+psycopg://user:secret@fake.neon.tech.evil.com/db?sslmode=require",
        "postgresql+psycopg://user:secret@ep-sample.us-west-2.aws.neon.tech/db",
    ]:
        monkeypatch.setenv("DATABASE_URL", database)
        assert demo_runtime.run() == 1
    output = capsys.readouterr().out
    assert "secret" not in output


def test_demo_runtime_uses_external_neon_only(monkeypatch):
    monkeypatch.setenv("APP_ENV", "demo")
    monkeypatch.setenv("PORT", "10000")
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql+psycopg://test:placeholder@ep-example.us-west-2.aws.neon.tech/bodyvision"
        "?sslmode=require",
    )
    captured = {}

    def fake_exec(executable, args, env):
        captured.update(executable=executable, args=args, env=env)
        raise RuntimeError("exec intercepted")

    monkeypatch.setattr(os, "execvpe", fake_exec)
    try:
        demo_runtime.run()
    except RuntimeError as err:
        assert str(err) == "exec intercepted"
    assert captured["executable"] == sys.executable
    assert captured["args"][2] == "uvicorn"
    assert "postgres" not in " ".join(captured["args"])
