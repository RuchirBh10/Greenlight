from conftest import ADMIN, CREATOR, MANAGER, REVIEWER, login, make_user, resolve_all, submit
from app.database import SessionLocal
from app.models import Workspace


def err(r, status, code):
    assert r.status_code == status, r.text
    assert r.json() == {"error": {"code": code, "message": r.json()["error"]["message"]}}


def test_every_route_needs_a_token(client):
    for method, path in [("get", "/reviews"), ("get", "/brand-kit/sources"), ("get", "/insights/summary"),
                         ("get", "/reviews/CL-1"), ("patch", "/findings/FD-1"), ("post", "/reviews/CL-1/approve")]:
        err(getattr(client, method)(path), 401, "unauthorized")
    err(client.get("/reviews", headers={"Authorization": "Bearer not.a.token"}), 401, "unauthorized")


def test_login_rejects_bad_credentials_with_same_message(client):
    a = client.post("/auth/login", json={"email": CREATOR, "password": "wrong"})
    b = client.post("/auth/login", json={"email": "nobody@acme.com", "password": "wrong"})
    err(a, 401, "unauthorized")
    assert a.json() == b.json()


def test_only_brand_admin_manages_brand_kit(client, h):
    body = {"kind": "fact", "title": "Returns", "text": "Returns are accepted within 30 days."}
    for role in ("creator", "manager", "reviewer"):
        err(client.post("/brand-kit/sources", headers=h[role], json=body), 403, "forbidden")
    r = client.post("/brand-kit/sources", headers=h["admin"], json=body)
    assert r.status_code == 201 and r.json()["version"] == "v2"
    for role in h:  # everyone can read
        assert client.get("/brand-kit/sources", headers=h[role]).status_code == 200


def test_only_creators_submit_drafts(client, h):
    for role in ("manager", "reviewer", "admin"):
        err(client.post("/reviews", headers=h[role], json={"title": "t", "content": "hello"}), 403, "forbidden")


def test_only_the_owning_creator_can_decide_findings(client, h):
    rid = submit(client, h["creator"])["id"]
    fid = client.get(f"/reviews/{rid}/findings", headers=h["creator"]).json()[0]["finding_id"]
    patch = {"action": "disputed", "reason": "We have an award.", "edited_text": None}
    for role in ("manager", "admin"):
        err(client.patch(f"/findings/{fid}", headers=h[role], json=patch), 403, "forbidden")
    make_user("other@acme.com", "creator")
    other = login(client, "other@acme.com")
    err(client.patch(f"/findings/{fid}", headers=other, json=patch), 403, "forbidden")
    assert client.patch(f"/findings/{fid}", headers=h["creator"], json=patch).status_code == 200


def test_creators_only_see_their_own_reviews(client, h):
    rid = submit(client, h["creator"])["id"]
    make_user("other@acme.com", "creator")
    other = login(client, "other@acme.com")
    assert client.get("/reviews", headers=other).json() == []
    err(client.get(f"/reviews/{rid}", headers=other), 404, "not_found")
    err(client.get(f"/reviews/{rid}/findings", headers=other), 404, "not_found")
    err(client.get(f"/reviews/{rid}/ai-disclosure", headers=other), 404, "not_found")
    assert [r["id"] for r in client.get("/reviews", headers=h["manager"]).json()] == [rid]


def test_reviewers_only_see_escalated_items(client, h):
    rid = submit(client, h["creator"])["id"]  # status: scanned
    assert client.get("/reviews", headers=h["reviewer"]).json() == []
    err(client.get(f"/reviews/{rid}", headers=h["reviewer"]), 404, "not_found")
    resolve_all(client, h["creator"], rid)  # -> in_review
    assert [r["id"] for r in client.get("/reviews", headers=h["reviewer"]).json()] == [rid]


def test_only_reviewers_approve_or_request_changes(client, h):
    rid = submit(client, h["creator"])["id"]
    resolve_all(client, h["creator"], rid)
    for role in ("creator", "manager", "admin"):
        err(client.post(f"/reviews/{rid}/approve", headers=h[role], json={"note": ""}), 403, "forbidden")
        err(client.post(f"/reviews/{rid}/request-changes", headers=h[role], json={"note": "x"}), 403, "forbidden")


def test_commenting_roles(client, h):
    rid = submit(client, h["creator"])["id"]
    assert client.post(f"/reviews/{rid}/comments", headers=h["creator"], json={"text": "hi"}).status_code == 201
    assert client.post(f"/reviews/{rid}/comments", headers=h["manager"], json={"text": "hi"}).status_code == 201
    assert client.post(f"/reviews/{rid}/comments", headers=h["admin"], json={"text": "hi"}).status_code == 201   # anyone who can open the review
    err(client.post(f"/reviews/{rid}/comments", headers=h["reviewer"], json={"text": "hi"}), 404, "not_found")   # reviewers only see escalated work


def test_guideline_gaps_are_brand_admin_only(client, h):
    assert client.get("/insights/gaps", headers=h["admin"]).status_code == 200
    for role in ("creator", "manager", "reviewer"):
        err(client.get("/insights/gaps", headers=h[role]), 403, "forbidden")


def test_workspaces_are_isolated(client, h):
    rid = submit(client, h["creator"])["id"]
    with SessionLocal() as db:
        db.add(Workspace(id="W-2", name="Other Co"))
        db.commit()
    make_user("x@other.com", "manager", workspace_id="W-2")
    x = login(client, "x@other.com")
    assert client.get("/reviews", headers=x).json() == []
    assert client.get("/brand-kit/sources", headers=x).json() == []
    err(client.get(f"/reviews/{rid}", headers=x), 404, "not_found")


def test_validation_errors_use_the_standard_shape(client, h):
    r = client.post("/reviews", headers=h["creator"], json={"title": ""})
    err(r, 422, "validation_error")
    err(client.get("/brand-kit/sources?kind=bogus", headers=h["creator"]), 422, "validation_error")


def test_there_is_no_ai_role_and_no_unauthenticated_approval_path(client):
    err(client.post("/reviews/CL-2001/approve", json={"note": "auto"}), 401, "unauthorized")
