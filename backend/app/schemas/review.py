from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.finding import FindingType

ReviewStatus = Literal["draft", "scanned", "resolving", "in_review", "approved", "changes_requested"]


class ReviewListItem(BaseModel):
    id: str
    title: str
    creator: str
    status: ReviewStatus
    finding_count: int
    updated_at: datetime


class ReviewCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    content: str = Field(min_length=1, max_length=50_000)
    intent_note: str = Field(default="", max_length=2000)


class ReviewCreated(BaseModel):
    id: str
    status: ReviewStatus
    finding_count: int


class ReviewDetail(BaseModel):
    id: str
    title: str
    content: str
    status: ReviewStatus
    creator: str
    brand_kit_version: str
    created_at: datetime
    updated_at: datetime


class CommentCreate(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    finding_id: str | None = None  # optional: the comment is about one finding of this review

    @field_validator("text")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("text must not be blank")
        return value


class CommentOut(BaseModel):
    id: str
    author: str
    role: str
    text: str
    created_at: datetime
    finding_id: str | None = None


class WorkflowNote(BaseModel):
    note: str = Field(default="", max_length=2000)


class WorkflowOut(BaseModel):
    id: str
    status: ReviewStatus


class TopIssue(BaseModel):
    type: FindingType
    count: int


class InsightsSummary(BaseModel):
    reviewed_this_month: int
    needs_attention: int
    awaiting_approval: int
    approved_this_month: int
    top_issues: list[TopIssue]


class InsightGap(BaseModel):
    source_id: str
    title: str
    dispute_count: int
    note: str


class DisclosureStep(BaseModel):
    step: str
    used_ai: bool
    model: str | None = None
    data_sent: str | None = None


class AiDisclosure(BaseModel):
    review_id: str
    steps: list[DisclosureStep]
