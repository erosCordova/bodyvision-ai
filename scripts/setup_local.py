"""Generate local-only credentials without displaying them. Never overwrites .env."""
import os
import secrets
from pathlib import Path

root = Path(__file__).resolve().parents[1]
target = root / ".env"
if target.exists():
    raise SystemExit(".env already exists; keep it or remove it intentionally before regenerating.")
admin = secrets.token_hex(32)
app = secrets.token_hex(32)
content = (root / ".env.example").read_text()
content = content.replace("postgres:GENERATED_BY_SETUP", "postgres:" + admin)
content = content.replace("bodyvision_app:GENERATED_BY_SETUP", "bodyvision_app:" + app)
content = content.replace("POSTGRES_PASSWORD=GENERATED_BY_SETUP", "POSTGRES_PASSWORD=" + admin)
content = content.replace("POSTGRES_APP_PASSWORD=GENERATED_BY_SETUP", "POSTGRES_APP_PASSWORD=" + app)
fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
with os.fdopen(fd, "w") as stream:
    stream.write(content)
print("Created .env with random local credentials. Do not share this file.")
