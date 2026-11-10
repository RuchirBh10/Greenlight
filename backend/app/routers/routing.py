from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.routing import (AssignOut, AssignRequest, EscalateRequest, EscalationOut, ResolveEscalationRequest,
                                 TeamMember)
from app.services import routing_service

router = APIRouter(tags=["routing"])


@router.get("/team/reviewers", response_model=list[TeamMember])
def list_reviewers(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return routing_service.reviewers(db, user)


@router.post("/reviews/{review_id}/assign", response_model=AssignOut)
def assign(review_id: str, body: AssignRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return routing_service.assign(db, user, review_id, body)


@router.post("/reviews/{review_id}/escalate", response_model=EscalationOut, status_code=201)
def escalate(review_id: str, body: EscalateRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return routing_service.escalate(db, user, review_id, body)


@router.post("/reviews/{review_id}/escalations/{escalation_id}/resolve", response_model=EscalationOut)
def resolve(review_id: str, escalation_id: str, body: ResolveEscalationRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return routing_service.resolve_escalation(db, user, review_id, escalation_id, body)
