from datetime import datetime

from pydantic import BaseModel


class ActivityActor(BaseModel):
    id: str
    name: str
    role: str


class ActivityEvent(BaseModel):
    """One line of a review's history. `actor` is null for the system (the automated check)."""

    id: str
    type: str
    at: datetime
    actor: ActivityActor | None
    summary: str
    reason: str = ""
    detail: dict = {}
    review_id: str | None = None
    review_title: str | None = None  # only filled in the workspace-wide feed


class VersionOut(BaseModel):
    number: int
    content: str
    reason: str
    created_by: str | None
    created_at: datetime
