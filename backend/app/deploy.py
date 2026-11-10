"""Serverless helpers for Vercel. Everything here is a no-op unless the VERCEL environment variable is set,
so local development, tests and a normal server behave exactly as before.

Why this exists: Vercel has no terminal and its disk is read-only, so the app prepares itself on start-up.
  1. picks a database URL (Vercel's Postgres integrations set DATABASE_URL or POSTGRES_URL),
  2. refuses to start with a weak JWT secret (a public API with a guessable secret is not safe),
  3. applies database migrations and creates the demo workspace the first time it runs.
"""
import logging
import os

log = logging.getLogger("greenlight.deploy")
ON_VERCEL = bool(os.environ.get("VERCEL"))

def _find_database_url() -> str:
    """Vercel's Neon integration may add a prefix to the variable name (for example STORAGE_DATABASE_URL).
    Prefer the pooled connection string; fall back to the unpooled one."""
    for name in ("DATABASE_URL", "POSTGRES_URL"):
        if os.environ.get(name):
            return os.environ[name]
    names = sorted(os.environ)
    for suffix in ("_DATABASE_URL", "_POSTGRES_URL", "_URL"):
        for name in names:
            value = os.environ[name]
            if name.endswith(suffix) and "UNPOOLED" not in name and "NON_POOLING" not in name and value.startswith(("postgres://", "postgresql://")):
                return value
    for name in names:
        if os.environ[name].startswith(("postgres://", "postgresql://")):
            return os.environ[name]
    return ""


if ON_VERCEL:
    url = _find_database_url()
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url:
        os.environ["DATABASE_URL"] = url
    else:
        # Temporary demo store. /tmp is wiped on cold starts and is not shared between instances.
        os.environ["DATABASE_URL"] = "sqlite:////tmp/greenlight_demo.db"
        log.warning("No DATABASE_URL set: using a temporary SQLite file. Data will reset. Add a Postgres database for stable data.")
    secret = os.environ.get("JWT_SECRET", "")
    if len(secret) < 32 or secret == "change-me":
        raise RuntimeError("Set JWT_SECRET to a random string of 32+ characters (Vercel > Settings > Environment Variables), then redeploy.")


def bootstrap() -> None:
    """Create tables and the demo workspace if the database is empty. Never stops the app from starting."""
    if not ON_VERCEL:
        return
    try:
        from app.database import SessionLocal
        from app.migrations import prepare_database
        from app.models import User
        from app.seed import seed

        prepare_database()
        with SessionLocal() as db:
            empty = db.query(User).first() is None
        if empty:
            seed()
            log.warning("Seeded the demo workspace.")
    except Exception:  # noqa: BLE001
        log.exception("Start-up bootstrap failed. The API will start, but requests may fail until the database is reachable.")
