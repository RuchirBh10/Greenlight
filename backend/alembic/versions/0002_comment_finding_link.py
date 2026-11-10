"""comments can be attached to a finding

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("comment") as batch:  # batch mode so SQLite can run it too
        batch.add_column(sa.Column("finding_id", sa.String(length=20), nullable=True))
        batch.create_foreign_key("fk_comment_finding_id", "finding", ["finding_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("comment") as batch:
        batch.drop_constraint("fk_comment_finding_id", type_="foreignkey")
        batch.drop_column("finding_id")
