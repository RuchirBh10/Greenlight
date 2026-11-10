"""Routing: who is responsible for a review, and escalating a question to someone who can rule on it.

Rules, all enforced here and in workflow_service._decide_review:
  - A manager or brand admin assigns a reviewer. Once assigned, only that reviewer can approve or request changes.
  - A reviewer can escalate an in-review item to a manager or brand admin, with a reason.
  - While an escalation is open nobody can approve or request changes. Only the role it was sent to can resolve it.
  - Every step is written to the audit trail and to the review's discussion thread.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import next_number
from app.errors import forbidden, invalid, not_found
from app.models.audit import Comment
from app.models.routing import Escalation
from app.models.user import User, utcnow
from app.schemas.routing import (AssignOut, AssignRequest, EscalateRequest, EscalationOut, Person,
                                 ResolveEscalationRequest, TeamMember)
from app.services import routing_context
from app.services.workflow_service import audit, load_review

ASSIGNERS = ("manager", "brand_admin")
ROLE_LABEL = {"manager": "manager", "brand_admin": "brand admin"}


def _thread(db: Session, review, author: User, text: str) -> None:
    """Mirror a routing action into the discussion so everyone on the review sees it without opening the audit trail."""
    db.add(Comment(id=f"C-{next_number(db, 'comment', 1)}", review_id=review.id, author_id=author.id, text=text))


def reviewers(db: Session, user: User) -> list[TeamMember]:
    if user.role not in ASSIGNERS:
        raise forbidden("Only managers and brand admins can see who can be assigned.")
    rows = db.scalars(select(User).where(User.workspace_id == user.workspace_id, User.role == "reviewer").order_by(User.name))
    return [TeamMember(id=u.id, name=u.name, role=u.role) for u in rows]


def assign(db: Session, user: User, review_id: str, body: AssignRequest) -> AssignOut:
    if user.role not in ASSIGNERS:
        raise forbidden("Only managers and brand admins can assign a reviewer.")
    review = load_review(db, user, review_id)
    if review.status == "approved":
        raise invalid("An approved review cannot be reassigned.")
    target = None
    if body.reviewer_id is not None:
        target = db.get(User, body.reviewer_id)
        if target is None or target.workspace_id != user.workspace_id or target.role != "reviewer":
            raise invalid("reviewer_id must be a reviewer in this workspace.")
    if review.assignee_id != (target.id if target else None):
        review.assignee_id = target.id if target else None
        review.updated_at = utcnow()
        audit(db, user, review.workspace_id, review.id, "review_assigned",
              {"assignee_id": target.id if target else None, "assignee": target.name if target else None}, body.note.strip())
        db.commit()
    return AssignOut(review_id=review.id, assignee=Person(id=target.id, name=target.name) if target else None)


def escalate(db: Session, user: User, review_id: str, body: EscalateRequest) -> EscalationOut:
    if user.role != "reviewer":
        raise forbidden("Only reviewers can escalate a review.")
    review = load_review(db, user, review_id)
    if review.status != "in_review":
        raise invalid(f"Only reviews that are in_review can be escalated (this one is {review.status}).")
    if review.assignee_id and review.assignee_id != user.id:
        raise forbidden("This review is assigned to another reviewer.")
    if routing_context.open_escalation(db, review.id):
        raise invalid("This review already has an open escalation.")
    esc = Escalation(id=f"ES-{next_number(db, 'escalation', 1)}", review_id=review.id, raised_by=user.id,
                     to_role=body.to_role, reason=body.reason, status="open")
    db.add(esc)
    review.updated_at = utcnow()
    db.flush()
    audit(db, user, review.workspace_id, review.id, "review_escalated", {"escalation_id": esc.id, "to_role": esc.to_role}, esc.reason)
    _thread(db, review, user, f"Escalated to {ROLE_LABEL[esc.to_role]}: {esc.reason}")
    db.commit()
    return routing_context.escalation_out(esc, routing_context.people(db, {esc.raised_by}))


def resolve_escalation(db: Session, user: User, review_id: str, escalation_id: str, body: ResolveEscalationRequest) -> EscalationOut:
    review = load_review(db, user, review_id)
    esc = db.get(Escalation, escalation_id)
    if esc is None or esc.review_id != review.id:
        raise not_found("Escalation not found.")
    if esc.status != "open":
        raise invalid("This escalation is already resolved.")
    if user.role != esc.to_role:
        raise forbidden(f"Only a {ROLE_LABEL[esc.to_role]} can resolve this escalation.")
    esc.status, esc.resolved_by, esc.resolved_at, esc.resolution = "resolved", user.id, utcnow(), body.resolution
    review.updated_at = utcnow()
    audit(db, user, review.workspace_id, review.id, "escalation_resolved", {"escalation_id": esc.id}, esc.resolution)
    _thread(db, review, user, f"Escalation resolved: {esc.resolution}")
    db.commit()
    return routing_context.escalation_out(esc, routing_context.people(db, {esc.raised_by, esc.resolved_by}))
