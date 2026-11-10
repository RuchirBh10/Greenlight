"""Database schema management: one entry point for Vercel start-up and `run_local.py`.

Schema changes ship as Alembic migrations (alembic/versions). This applies them on start-up so a deploy never
needs a manual step. A database created by an older version (tables but no alembic_version) is adopted at the
baseline revision first, so existing data is kept.
"""
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text

import app.models  # noqa: F401  (registers every table)
from app.database import ensure_extensions, engine

BACKEND_DIR = Path(__file__).resolve().parent.parent
BASELINE = "0001"
_LOCK_ID = 727274  # PostgreSQL advisory lock so two cold starts do not migrate at the same time


def _config() -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


def _upgrade() -> None:
    cfg = _config()
    tables = set(inspect(engine).get_table_names())
    if "alembic_version" not in tables and "app_user" in tables:
        command.stamp(cfg, BASELINE)
    command.upgrade(cfg, "head")


def prepare_database() -> None:
    ensure_extensions()
    if engine.dialect.name != "postgresql":
        _upgrade()
        return
    with engine.connect() as lock:
        lock.execute(text("SELECT pg_advisory_lock(:id)"), {"id": _LOCK_ID})
        try:
            _upgrade()
        finally:
            lock.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": _LOCK_ID})
            lock.commit()
