"""review assignee and escalations

Revision ID: 0003
Revises: 0002
"""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("review") as batch:  # batch mode so SQLite can run it too
        batch.add_column(sa.Column("assignee_id", sa.String(length=20), nullable=True))
        batch.create_foreign_key("fk_review_assignee_id", "app_user", ["assignee_id"], ["id"])
        batch.create_index(op.f("ix_review_assignee_id"), ["assignee_id"])
    op.create_table(
        "escalation",
        sa.Column("id", sa.String(length=20), primary_key=True),
        sa.Column("review_id", sa.String(length=20), sa.ForeignKey("review.id"), nullable=False),
        sa.Column("raised_by", sa.String(length=20), sa.ForeignKey("app_user.id"), nullable=False),
        sa.Column("to_role", sa.String(length=20), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_by", sa.String(length=20), sa.ForeignKey("app_user.id"), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution", sa.Text(), nullable=False),
    )
    op.create_index(op.f("ix_escalation_review_id"), "escalation", ["review_id"])
    op.create_index("uq_escalation_one_open", "escalation", ["review_id"], unique=True,
                    sqlite_where=sa.text("status = 'open'"), postgresql_where=sa.text("status = 'open'"))


def downgrade() -> None:
    op.drop_index("uq_escalation_one_open", table_name="escalation")
    op.drop_index(op.f("ix_escalation_review_id"), table_name="escalation")
    op.drop_table("escalation")
    with op.batch_alter_table("review") as batch:
        batch.drop_index(op.f("ix_review_assignee_id"))
        batch.drop_constraint("fk_review_assignee_id", type_="foreignkey")
        batch.drop_column("assignee_id")
