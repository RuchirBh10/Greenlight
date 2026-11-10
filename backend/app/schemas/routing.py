from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


def _not_blank(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("must not be blank")
    return value


class Person(BaseModel):
    id: str
    name: str


class TeamMember(Person):
    role: str


class AssignRequest(BaseModel):
    reviewer_id: str | None = None  # null removes the assignee
    note: str = Field(default="", max_length=1000)


class AssignOut(BaseModel):
    review_id: str
    assignee: Person | None


class EscalateRequest(BaseModel):
    to_role: Literal["manager", "brand_admin"]
    reason: str = Field(min_length=1, max_length=2000)

    _clean = field_validator("reason")(_not_blank)


class ResolveEscalationRequest(BaseModel):
    resolution: str = Field(min_length=1, max_length=2000)

    _clean = field_validator("resolution")(_not_blank)


class EscalationOut(BaseModel):
    id: str
    review_id: str
    raised_by: Person
    to_role: str
    reason: str
    status: Literal["open", "resolved"]
    created_at: datetime
    resolved_by: Person | None = None
    resolved_at: datetime | None = None
    resolution: str = ""
