"""The migrations must build the same schema as the models, and adopt a database made before migrations existed."""
import os

import pytest
from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from app import migrations
from app.database import Base


def test_head_revision_matches_the_models():
    """If this fails, a model changed without a migration (run: alembic revision --autogenerate)."""
    if not os.environ.get("TEST_DATABASE_URL", "").startswith("postgresql"):
        pytest.skip("drift check runs against PostgreSQL (TEST_DATABASE_URL)")
    cfg = migrations._config()
    Base.metadata.drop_all(migrations.engine)
    with migrations.engine.begin() as c:
        c.execute(text("DROP TABLE IF EXISTS alembic_version"))
    migrations.prepare_database()
    command.check(cfg)  # raises if the models and migrations disagree


def test_prepare_database_is_repeatable_and_adopts_an_old_database():
    if not os.environ.get("TEST_DATABASE_URL", "").startswith("postgresql"):
        pytest.skip("runs against PostgreSQL (TEST_DATABASE_URL)")
    eng = migrations.engine
    Base.metadata.drop_all(eng)
    with eng.begin() as c:
        c.execute(text("DROP TABLE IF EXISTS alembic_version"))
    command.upgrade(migrations._config(), migrations.BASELINE)      # the schema as it was before v6
    with eng.begin() as c:
        c.execute(text("DROP TABLE alembic_version"))               # an old create_all database has no version table
        c.execute(text("INSERT INTO workspace (id, name, created_at) VALUES ('W-X', 'kept', now())"))
    migrations.prepare_database()
    migrations.prepare_database()                                    # running it twice changes nothing
    insp = inspect(eng)
    assert "finding_id" in [col["name"] for col in insp.get_columns("comment")]            # 0002
    assert "assignee_id" in [col["name"] for col in insp.get_columns("review")]            # 0003
    assert "escalation" in insp.get_table_names()
    with eng.connect() as c:
        assert c.execute(text("SELECT name FROM workspace WHERE id='W-X'")).scalar() == "kept"
        assert c.execute(text("SELECT version_num FROM alembic_version")).scalar() == ScriptDirectory.from_config(migrations._config()).get_current_head()
