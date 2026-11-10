"""Who is responsible for a review and whether anything is blocking it. Read helpers shared by the workflow and
routing services (kept apart so neither imports the other)."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.review import Review
from app.models.routing import Escalation
from app.models.user import User
from app.schemas.routing import EscalationOut, Person


def people(db: Session, ids: set[str | None]) -> dict[str, Person]:
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    return {u.id: Person(id=u.id, name=u.name) for u in db.scalars(select(User).where(User.id.in_(wanted)))}


def escalation_out(e: Escalation, known: dict[str, Person]) -> EscalationOut:
    return EscalationOut(
        id=e.id, review_id=e.review_id, raised_by=known[e.raised_by], to_role=e.to_role, reason=e.reason, status=e.status,
        created_at=e.created_at, resolved_by=known.get(e.resolved_by) if e.resolved_by else None, resolved_at=e.resolved_at,
        resolution=e.resolution or "")


def open_escalation(db: Session, review_id: str) -> Escalation | None:
    return db.scalars(select(Escalation).where(Escalation.review_id == review_id, Escalation.status == "open")).first()


def for_reviews(db: Session, reviews: list[Review]) -> dict[str, tuple[Person | None, EscalationOut | None]]:
    """review id -> (assignee, open escalation), using two queries however many reviews there are."""
    if not reviews:
        return {}
    open_rows = {e.review_id: e for e in db.scalars(
        select(Escalation).where(Escalation.review_id.in_([r.id for r in reviews]), Escalation.status == "open"))}
    known = people(db, {r.assignee_id for r in reviews} | {e.raised_by for e in open_rows.values()})
    return {r.id: (known.get(r.assignee_id) if r.assignee_id else None,
                   escalation_out(open_rows[r.id], known) if r.id in open_rows else None) for r in reviews}
