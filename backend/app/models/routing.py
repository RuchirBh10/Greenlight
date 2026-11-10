from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.user import utcnow


class Escalation(Base):
    """A reviewer asking a manager or brand admin to rule on something before the review can be decided.
    A review can have many over time but only one open at a time (enforced by the partial unique index)."""

    __tablename__ = "escalation"
    __table_args__ = (
        Index("uq_escalation_one_open", "review_id", unique=True,
              sqlite_where=text("status = 'open'"), postgresql_where=text("status = 'open'")),
    )
    id: Mapped[str] = mapped_column(String(20), primary_key=True)  # ES-n
    review_id: Mapped[str] = mapped_column(ForeignKey("review.id"), index=True)
    raised_by: Mapped[str] = mapped_column(ForeignKey("app_user.id"))
    to_role: Mapped[str] = mapped_column(String(20))  # manager | brand_admin
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10), default="open")  # open | resolved
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_by: Mapped[str | None] = mapped_column(ForeignKey("app_user.id"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution: Mapped[str] = mapped_column(Text, default="")
