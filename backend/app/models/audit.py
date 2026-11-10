from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.user import utcnow


class Comment(Base):
    __tablename__ = "comment"
    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    review_id: Mapped[str] = mapped_column(ForeignKey("review.id"), index=True)
    author_id: Mapped[str] = mapped_column(ForeignKey("app_user.id"))
    finding_id: Mapped[str | None] = mapped_column(ForeignKey("finding.id"), nullable=True)  # set when the comment is about one finding
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Approval(Base):
    """A human approve / request-changes decision. Only human roles can create these."""

    __tablename__ = "approval"
    pk: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    review_id: Mapped[str] = mapped_column(ForeignKey("review.id"), index=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey("app_user.id"))
    decision: Mapped[str] = mapped_column(String(30))  # approved | changes_requested
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditEvent(Base):
    """Every change, comment and decision: who (actor), when, why (reason). actor_id is null for the system."""

    __tablename__ = "audit_event"
    pk: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.id"), index=True)
    review_id: Mapped[str | None] = mapped_column(ForeignKey("review.id"), nullable=True, index=True)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("app_user.id"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(40))
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    reason: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AiCallLog(Base):
    """What was (or was not) sent to an AI service. Stores counts and labels, never the draft text."""

    __tablename__ = "ai_call_log"
    pk: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    review_id: Mapped[str] = mapped_column(ForeignKey("review.id"), index=True)
    step: Mapped[str] = mapped_column(String(30))  # rules | retrieve | judge
    used_ai: Mapped[bool] = mapped_column(Boolean, default=False)
    model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    sentences_sent: Mapped[int] = mapped_column(Integer, default=0)
    sources_sent: Mapped[int] = mapped_column(Integer, default=0)
    success: Mapped[bool] = mapped_column(Boolean, default=True)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
