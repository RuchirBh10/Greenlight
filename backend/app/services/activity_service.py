"""Read side of the review workflow: the activity timeline, comments and draft versions.

Everything here uses the same visibility rules as the review itself (workflow_service.load_review), so nobody
can read the history of a review they cannot open. Writes stay in workflow_service; this module never changes data.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit import AuditEvent, Comment
from app.models.finding import Finding
from app.models.review import Review, ReviewVersion
from app.models.user import User
from app.schemas.activity import ActivityActor, ActivityEvent, VersionOut
from app.schemas.review import CommentOut
from app.services.workflow_service import load_review, visible_reviews_query

_DECISION_VERB = {"accepted": "Confirmed", "edited": "Edited", "disputed": "Marked not applicable"}
_STATUS_LABEL = {"draft": "draft", "scanned": "needs attention", "resolving": "being resolved", "in_review": "in review",
                 "changes_requested": "changes requested", "approved": "approved"}
_ROLE_LABEL = {"manager": "a manager", "brand_admin": "a brand admin"}
# The explicit "approved" / "changes_requested" events already say this, so the matching status change is not repeated.
_REDUNDANT_STATUS = ("approved", "changes_requested")


def _summary(e: AuditEvent, quote: str | None) -> str:
    d, t = e.detail or {}, e.event_type
    if t == "review_submitted":
        return f"Submitted for review ({d['brand_kit_version']})" if d.get("brand_kit_version") else "Submitted for review"
    if t == "scan_completed":
        n = d.get("findings", 0)
        mode = "rules only" if d.get("mode") == "rules_only" else "full check"
        return f"Automated check finished: {n} potential issue{'' if n == 1 else 's'} ({mode})"
    if t == "content_edited":
        return f"Edited the draft (version {d.get('version', '?')})"
    if t == "finding_decision":
        verb = _DECISION_VERB.get(d.get("action", ""), "Updated")
        return f"{verb} “{quote}”" if quote else f"{verb} a finding"
    if t == "comment_added":
        return "Commented"
    if t == "approved":
        return "Approved for publication"
    if t == "changes_requested":
        return "Requested changes"
    if t == "review_assigned":
        return f"Assigned to {d['assignee']}" if d.get("assignee") else "Removed the assigned reviewer"
    if t == "review_escalated":
        return f"Escalated to {_ROLE_LABEL.get(d.get('to_role'), d.get('to_role'))}"
    if t == "escalation_resolved":
        return "Resolved the escalation"
    if t == "status_changed":
        return f"Status changed from {_STATUS_LABEL.get(d.get('from'), d.get('from'))} to {_STATUS_LABEL.get(d.get('to'), d.get('to'))}"
    return t.replace("_", " ").capitalize()


def _to_events(db: Session, rows: list[AuditEvent], titles: dict[str, str] | None = None) -> list[ActivityEvent]:
    rows = [e for e in rows if not (e.event_type == "status_changed" and (e.detail or {}).get("to") in _REDUNDANT_STATUS)]
    actor_ids = {e.actor_id for e in rows if e.actor_id}
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(actor_ids)))} if actor_ids else {}
    finding_ids = {e.detail["finding_id"] for e in rows if (e.detail or {}).get("finding_id")}
    findings = {f.id: f for f in db.scalars(select(Finding).where(Finding.id.in_(finding_ids)))} if finding_ids else {}
    comment_ids = {e.detail["comment_id"] for e in rows if (e.detail or {}).get("comment_id")}
    comments = {c.id: c for c in db.scalars(select(Comment).where(Comment.id.in_(comment_ids)))} if comment_ids else {}

    out: list[ActivityEvent] = []
    for e in rows:
        detail = dict(e.detail or {})
        finding = findings.get(detail.get("finding_id"))
        quote = finding.span_text if finding else None
        if quote:
            detail["quote"] = quote
        comment = comments.get(detail.get("comment_id"))
        if comment:
            detail["text"] = comment.text
        u = users.get(e.actor_id) if e.actor_id else None
        out.append(ActivityEvent(
            id=f"E-{e.pk}", type=e.event_type, at=e.created_at,
            actor=ActivityActor(id=u.id, name=u.name, role=u.role) if u else None,
            summary=_summary(e, quote), reason=e.reason or "", detail=detail,
            review_id=e.review_id, review_title=(titles or {}).get(e.review_id)))
    return out


def activity(db: Session, user: User, review_id: str) -> list[ActivityEvent]:
    """The full history of one review, oldest first."""
    review = load_review(db, user, review_id)
    rows = list(db.scalars(select(AuditEvent).where(AuditEvent.review_id == review.id).order_by(AuditEvent.pk)))
    return _to_events(db, rows)


def feed(db: Session, user: User, limit: int = 100) -> list[ActivityEvent]:
    """Recent activity across every review the user can see, newest first."""
    reviews = {r.id: r.title for r in db.scalars(visible_reviews_query(user))}
    if not reviews:
        return []
    rows = list(db.scalars(select(AuditEvent).where(AuditEvent.review_id.in_(reviews))
                           .order_by(AuditEvent.pk.desc()).limit(limit)))
    return _to_events(db, rows, reviews)


def comments(db: Session, user: User, review_id: str) -> list[CommentOut]:
    review = load_review(db, user, review_id)
    rows = list(db.scalars(select(Comment).where(Comment.review_id == review.id).order_by(Comment.created_at, Comment.id)))
    authors = {u.id: u for u in db.scalars(select(User).where(User.id.in_({c.author_id for c in rows})))} if rows else {}
    return [CommentOut(id=c.id, author=authors[c.author_id].name, role=authors[c.author_id].role, text=c.text,
                       created_at=c.created_at, finding_id=c.finding_id) for c in rows]


def versions(db: Session, user: User, review_id: str) -> list[VersionOut]:
    """Every saved text of the draft, oldest first. Version 1 is what was submitted."""
    review = load_review(db, user, review_id)
    rows = list(db.scalars(select(ReviewVersion).where(ReviewVersion.review_id == review.id).order_by(ReviewVersion.number)))
    names = {u.id: u.name for u in db.scalars(select(User).where(User.id.in_({v.created_by for v in rows if v.created_by})))} if rows else {}
    return [VersionOut(number=v.number, content=v.content, reason=v.reason, created_by=names.get(v.created_by),
                       created_at=v.created_at) for v in rows]
