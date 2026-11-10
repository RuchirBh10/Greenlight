from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.activity import ActivityEvent, VersionOut
from app.schemas.finding import FindingOut
from app.schemas.review import (AiDisclosure, CommentCreate, CommentOut, ReviewCreate, ReviewCreated, ReviewDetail,
                                ReviewListItem)
from app.services import activity_service, ai_disclosure, workflow_service as wf

router = APIRouter(prefix="/reviews", tags=["reviews"])


@router.get("", response_model=list[ReviewListItem])
def list_reviews(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return wf.list_reviews(db, user)


@router.post("", response_model=ReviewCreated, status_code=201)
def create_review(body: ReviewCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return wf.create_review(db, user, body)


@router.get("/{review_id}", response_model=ReviewDetail)
def get_review(review_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return wf.get_review(db, user, review_id)


@router.get("/{review_id}/findings", response_model=list[FindingOut])
def get_findings(review_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return wf.get_findings(db, user, review_id)


@router.post("/{review_id}/comments", response_model=CommentOut, status_code=201)
def add_comment(review_id: str, body: CommentCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return wf.add_comment(db, user, review_id, body)


@router.get("/{review_id}/comments", response_model=list[CommentOut])
def get_comments(review_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return activity_service.comments(db, user, review_id)


@router.get("/{review_id}/activity", response_model=list[ActivityEvent])
def get_activity(review_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return activity_service.activity(db, user, review_id)


@router.get("/{review_id}/versions", response_model=list[VersionOut])
def get_versions(review_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return activity_service.versions(db, user, review_id)


@router.get("/{review_id}/ai-disclosure", response_model=AiDisclosure, response_model_exclude_none=True)
def get_disclosure(review_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    wf.load_review(db, user, review_id)  # same visibility as the review itself
    return ai_disclosure.build(db, review_id)
