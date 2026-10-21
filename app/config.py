"""Settings, read from environment variables (see .env.example)."""
from __future__ import annotations

import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.environ.get("DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)


def _secret_key() -> str:
    key = os.environ.get("SECRET_KEY")
    if key:
        return key
    # Development fallback: persist a random key so sessions survive restarts.
    f = DATA_DIR / ".secret_key"
    if not f.exists():
        f.write_text(secrets.token_urlsafe(48))
        f.chmod(0o600)
    return f.read_text().strip()


SECRET_KEY = _secret_key()
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{DATA_DIR / 'app.db'}")
# Set COOKIE_SECURE=0 only for local development over plain http.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "1") != "0"
SESSION_HOURS = int(os.environ.get("SESSION_HOURS", "12"))
APP_NAME = os.environ.get("APP_NAME", "PV Toolkit")

# Login protection
MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 15
MIN_PASSWORD_LENGTH = 12
