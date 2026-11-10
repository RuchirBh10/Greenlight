"""v6.2: assigning reviewers and escalating questions."""
from conftest import PASSWORD, SessionLocal, User, hash_password, login, next_number, resolve_all, submit
from test_permissions import err


def _in_review(client, h):
    rid = submit(client, h["creator"])["id"]
    resolve_all(client, h["creator"], rid)
    assert client.get(f"/reviews/{rid}", headers=h["creator"]).json()["status"] == "in_review"
    return rid


def _second_reviewer(client):
    with SessionLocal() as db:
        ws = db.query(User).first().workspace_id
        u = User(id=f"U-{next_number(db, 'user', 1)}", workspace_id=ws, name="Second Reviewer", email="second@acme.com",
                 password_hash=hash_password(PASSWORD), role="reviewer")
        db.add(u)
        db.commit()
        uid = u.id
    return uid, login(client, "second@acme.com")


def _priya(client, h):
    return next(m for m in client.get("/team/reviewers", headers=h["manager"]).json() if m["name"] == "Priya Nair")


def test_only_managers_and_admins_list_reviewers(client, h):
    for role in ("manager", "admin"):
        r = client.get("/team/reviewers", headers=h[role])
        assert r.status_code == 200 and [m["name"] for m in r.json()] == ["Priya Nair"] and r.json()[0]["role"] == "reviewer"
    err(client.get("/team/reviewers", headers=h["creator"]), 403, "forbidden")
    err(client.get("/team/reviewers", headers=h["reviewer"]), 403, "forbidden")
    assert client.get("/team/reviewers").status_code == 401


def test_assign_rules_and_visibility_of_the_assignee(client, h):
    rid = _in_review(client, h)
    priya = _priya(client, h)
    r = client.post(f"/reviews/{rid}/assign", headers=h["manager"], json={"reviewer_id": priya["id"], "note": "You know this brand"})
    assert r.status_code == 200 and r.json() == {"review_id": rid, "assignee": {"id": priya["id"], "name": "Priya Nair"}}
    detail = client.get(f"/reviews/{rid}", headers=h["creator"]).json()
    assert detail["assignee"]["name"] == "Priya Nair" and detail["open_escalation"] is None
    assert next(x for x in client.get("/reviews", headers=h["manager"]).json() if x["id"] == rid)["assignee"]["id"] == priya["id"]
    for role in ("creator", "reviewer"):
        err(client.post(f"/reviews/{rid}/assign", headers=h[role], json={"reviewer_id": priya["id"]}), 403, "forbidden")
    assert client.post(f"/reviews/{rid}/assign", headers=h["admin"], json={"reviewer_id": priya["id"]}).status_code == 200
    # the assignee must be a reviewer
    err(client.post(f"/reviews/{rid}/assign", headers=h["manager"], json={"reviewer_id": "U-1"}), 422, "validation_error")   # a creator
    err(client.post(f"/reviews/{rid}/assign", headers=h["manager"], json={"reviewer_id": "U-999"}), 422, "validation_error")
    err(client.post("/reviews/CL-9999/assign", headers=h["manager"], json={"reviewer_id": priya["id"]}), 404, "not_found")
    # unassigning
    assert client.post(f"/reviews/{rid}/assign", headers=h["manager"], json={"reviewer_id": None}).json()["assignee"] is None
    ev = client.get(f"/reviews/{rid}/activity", headers=h["manager"]).json()
    kinds = [(e["type"], e["summary"]) for e in ev if e["type"] == "review_assigned"]
    assert kinds[0] == ("review_assigned", "Assigned to Priya Nair") and kinds[-1] == ("review_assigned", "Removed the assigned reviewer")
    assert next(e for e in ev if e["type"] == "review_assigned")["reason"] == "You know this brand"


def test_assignment_repeated_is_a_no_op_and_approved_is_locked(client, h):
    rid = _in_review(client, h)
    priya = _priya(client, h)
    for _ in range(2):
        client.post(f"/reviews/{rid}/assign", headers=h["manager"], json={"reviewer_id": priya["id"]})
    ev = client.get(f"/reviews/{rid}/activity", headers=h["manager"]).json()
    assert len([e for e in ev if e["type"] == "review_assigned"]) == 1
    assert client.post(f"/reviews/{rid}/approve", headers=h["reviewer"], json={"note": "ok"}).status_code == 200
    err(client.post(f"/reviews/{rid}/assign", headers=h["manager"], json={"reviewer_id": None}), 422, "validation_error")


def test_only_the_assignee_can_decide(client, h):
    rid = _in_review(client, h)
    other_id, other = _second_reviewer(client)
    # unassigned: any reviewer may decide
    assert client.post(f"/reviews/{rid}/assign", headers=h["manager"], json={"reviewer_id": other_id}).status_code == 200
    err(client.post(f"/reviews/{rid}/approve", headers=h["reviewer"], json={"note": "ok"}), 403, "forbidden")          # Priya is not the assignee
    err(client.post(f"/reviews/{rid}/request-changes", headers=h["reviewer"], json={"note": "no"}), 403, "forbidden")
    err(client.post(f"/reviews/{rid}/escalate", headers=h["reviewer"], json={"to_role": "manager", "reason": "x"}), 403, "forbidden")
    assert client.post(f"/reviews/{rid}/approve", headers=other, json={"note": "ok"}).status_code == 200            # the assignee can


def test_escalation_blocks_decisions_until_the_right_role_resolves_it(client, h):
    rid = _in_review(client, h)
    esc = client.post(f"/reviews/{rid}/escalate", headers=h["reviewer"], json={"to_role": "brand_admin", "reason": "Is this claim covered by an approved fact?"})
    assert esc.status_code == 201
    e = esc.json()
    assert e["status"] == "open" and e["to_role"] == "brand_admin" and e["raised_by"]["name"] == "Priya Nair" and e["id"].startswith("ES-")
    detail = client.get(f"/reviews/{rid}", headers=h["manager"]).json()
    assert detail["open_escalation"]["id"] == e["id"] and detail["status"] == "in_review"
    err(client.post(f"/reviews/{rid}/escalate", headers=h["reviewer"], json={"to_role": "manager", "reason": "again"}), 422, "validation_error")   # one at a time
    err(client.post(f"/reviews/{rid}/approve", headers=h["reviewer"], json={"note": "ok"}), 422, "validation_error")
    err(client.post(f"/reviews/{rid}/request-changes", headers=h["reviewer"], json={"note": "no"}), 422, "validation_error")
    # only the targeted role may resolve
    url = f"/reviews/{rid}/escalations/{e['id']}/resolve"
    for role in ("creator", "reviewer", "manager"):
        err(client.post(url, headers=h[role], json={"resolution": "fine"}), 403, "forbidden")
    err(client.post(url, headers=h["admin"], json={"resolution": "   "}), 422, "validation_error")
    err(client.post(f"/reviews/{rid}/escalations/ES-999/resolve", headers=h["admin"], json={"resolution": "x"}), 404, "not_found")
    done = client.post(url, headers=h["admin"], json={"resolution": "Covered by F-12. Approved wording is fine."})
    assert done.status_code == 200 and done.json()["status"] == "resolved" and done.json()["resolved_by"]["name"] == "Ruchir Bharadwaj"
    err(client.post(url, headers=h["admin"], json={"resolution": "again"}), 422, "validation_error")                            # already resolved
    assert client.get(f"/reviews/{rid}", headers=h["manager"]).json()["open_escalation"] is None
    assert client.post(f"/reviews/{rid}/approve", headers=h["reviewer"], json={"note": "ok"}).status_code == 200                    # unblocked


def test_escalation_validation_and_who_may_raise_it(client, h):
    rid = _in_review(client, h)
    for role in ("creator", "manager", "admin"):
        err(client.post(f"/reviews/{rid}/escalate", headers=h[role], json={"to_role": "manager", "reason": "x"}), 403, "forbidden")
    for bad in ({"to_role": "creator", "reason": "x"}, {"to_role": "manager", "reason": "   "}, {"to_role": "manager"}):
        assert client.post(f"/reviews/{rid}/escalate", headers=h["reviewer"], json=bad).status_code == 422
    early = submit(client, h["creator"], title="Not ready")["id"]                                                                # status: scanned
    err(client.post(f"/reviews/{early}/escalate", headers=h["reviewer"], json={"to_role": "manager", "reason": "x"}), 404, "not_found")


def test_a_second_escalation_is_allowed_after_the_first_is_resolved(client, h):
    rid = _in_review(client, h)
    first = client.post(f"/reviews/{rid}/escalate", headers=h["reviewer"], json={"to_role": "manager", "reason": "one"}).json()
    client.post(f"/reviews/{rid}/escalations/{first['id']}/resolve", headers=h["manager"], json={"resolution": "ok"})
    second = client.post(f"/reviews/{rid}/escalate", headers=h["reviewer"], json={"to_role": "brand_admin", "reason": "two"})
    assert second.status_code == 201 and second.json()["id"] != first["id"]


def test_routing_is_in_the_activity_and_the_discussion(client, h):
    rid = _in_review(client, h)
    e = client.post(f"/reviews/{rid}/escalate", headers=h["reviewer"], json={"to_role": "brand_admin", "reason": "Needs a brand ruling"}).json()
    client.post(f"/reviews/{rid}/escalations/{e['id']}/resolve", headers=h["admin"], json={"resolution": "Ruling: fine"})
    ev = client.get(f"/reviews/{rid}/activity", headers=h["creator"]).json()
    esc = next(x for x in ev if x["type"] == "review_escalated")
    assert esc["summary"] == "Escalated to a brand admin" and esc["reason"] == "Needs a brand ruling" and esc["actor"]["role"] == "reviewer"
    res = next(x for x in ev if x["type"] == "escalation_resolved")
    assert res["summary"] == "Resolved the escalation" and res["reason"] == "Ruling: fine" and res["actor"]["role"] == "brand_admin"
    texts = [c["text"] for c in client.get(f"/reviews/{rid}/comments", headers=h["creator"]).json()]
    assert "Escalated to brand admin: Needs a brand ruling" in texts and "Escalation resolved: Ruling: fine" in texts


def test_list_shows_assignment_and_escalation_for_every_review(client, h):
    a, b = _in_review(client, h), _in_review(client, h)
    client.post(f"/reviews/{a}/escalate", headers=h["reviewer"], json={"to_role": "manager", "reason": "q"})
    rows = {r["id"]: r for r in client.get("/reviews", headers=h["manager"]).json()}
    assert rows[a]["open_escalation"]["to_role"] == "manager" and rows[b]["open_escalation"] is None and rows[b]["assignee"] is None
