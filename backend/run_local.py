"""One-command local start: python run_local.py

Runs the backend on a local SQLite file (no PostgreSQL needed), creates the tables, adds the demo
users the first time, and starts the server on http://localhost:8000. For the real PostgreSQL stack
use the steps in README.md instead. Rules-only checks work without an Anthropic key.
"""
import os

# Defaults for local use only. Anything already set in your environment or .env wins.
os.environ.setdefault("DATABASE_URL", "sqlite:///./local_greenlight.db")
os.environ.setdefault("JWT_SECRET", "local-development-secret-not-for-production-use")
os.environ.setdefault("ALLOWED_ORIGIN", "http://localhost:3000")

import uvicorn  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.migrations import prepare_database  # noqa: E402
from app.models import User  # noqa: E402
from app.seed import seed  # noqa: E402

prepare_database()
with SessionLocal() as db:
    has_users = db.query(User).first() is not None
if not has_users:
    seed()
else:
    print("Demo data already present. Delete local_greenlight.db to start fresh.")

print("\nBackend ready: http://localhost:8000/docs  (log in with the demo accounts above)\n")
uvicorn.run("app.main:app", host="127.0.0.1", port=8000)
