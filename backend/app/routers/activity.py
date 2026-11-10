from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.activity import ActivityEvent
from app.services import activity_service

router = APIRouter(prefix="/activity", tags=["activity"])


@router.get("", response_model=list[ActivityEvent])
def recent_activity(limit: int = Query(100, ge=1, le=200), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Newest-first activity across every review the caller can see."""
    return activity_service.feed(db, user, limit)
