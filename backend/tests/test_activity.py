"""v6.1: the activity timeline, comments and draft versions."""
from conftest import submit
from test_permissions import err  # noqa: F401  (shared helper)


def _flow(client, h):
    """Submit, resolve every finding, request changes, resolve again, approve. Returns the review id."""
    rid = submit(client, h["creator"])["id"]
    for f in client.get(f"/reviews/{rid}/findings", headers=h["creator"]).json():
        body = ({"action": "edited", "edited_text": f["suggestion"]["text"]} if f["suggestion"]
                else {"action": "disputed", "reason": "Approved for this campaign"})
        assert client.patch(f"/findings/{f['finding_id']}", headers=h["creator"], json=body).status_code == 200
    return rid


def test_activity_is_complete_ordered_and_attributed(client, h):
    rid = _flow(client, h)
    assert client.post(f"/reviews/{rid}/request-changes", headers=h["reviewer"], json={"note": "Check the delivery claim"}).status_code == 200
    ev = client.get(f"/reviews/{rid}/activity", headers=h["creator"]).json()
    types = [e["type"] for e in ev]
    assert types[0] == "review_submitted" and "scan_completed" in types
    assert types.count("finding_decision") == len(client.get(f"/reviews/{rid}/findings", headers=h["creator"]).json())
    assert types[-1] == "changes_requested"
    assert [e["id"] for e in ev] == sorted((e["id"] for e in ev), key=lambda i: int(i[2:]))  # oldest first
    # who did what
    assert ev[0]["actor"]["name"] == "Aarav Mehta" and ev[0]["actor"]["role"] == "creator"
    scan = next(e for e in ev if e["type"] == "scan_completed")
    assert scan["actor"] is None and "Automated check" in scan["summary"]          # the system, not a person
    last = ev[-1]
    assert last["actor"]["role"] == "reviewer" and last["reason"] == "Check the delivery claim"
    # the status change that the decision already explains is not repeated
    assert not [e for e in ev if e["type"] == "status_changed" and e["detail"].get("to") in ("approved", "changes_requested")]
    # decisions show what they were about
    d = next(e for e in ev if e["type"] == "finding_decision")
    assert d["detail"]["quote"] and d["detail"]["quote"] in d["summary"]


def test_every_mutating_action_leaves_an_event(client, h):
    rid = submit(client, h["creator"])["id"]
    fid = client.get(f"/reviews/{rid}/findings", headers=h["creator"]).json()[0]["finding_id"]
    n = lambda: len(client.get(f"/reviews/{rid}/activity", headers=h["manager"]).json())  # noqa: E731
    before = n()
    client.patch(f"/findings/{fid}", headers=h["creator"], json={"action": "disputed", "reason": "n/a"})
    after_decision = n()
    assert after_decision > before
    client.post(f"/reviews/{rid}/comments", headers=h["creator"], json={"text": "Hello"})
    assert n() == after_decision + 1


def test_activity_follows_review_visibility(client, h):
    rid = submit(client, h["creator"])["id"]                                   # status: scanned
    assert client.get(f"/reviews/{rid}/activity", headers=h["manager"]).status_code == 200
    assert client.get(f"/reviews/{rid}/activity", headers=h["admin"]).status_code == 200
    err(client.get(f"/reviews/{rid}/activity", headers=h["reviewer"]), 404, "not_found")   # reviewers only see escalated work
    err(client.get(f"/reviews/{rid}/comments", headers=h["reviewer"]), 404, "not_found")
    err(client.get(f"/reviews/{rid}/versions", headers=h["reviewer"]), 404, "not_found")
    err(client.get("/reviews/CL-9999/activity", headers=h["creator"]), 404, "not_found")
    assert client.get("/reviews/CL-9999/activity").status_code == 401


def test_comments_everyone_who_can_see_it_and_finding_links(client, h):
    rid = _flow(client, h)                                                     # now in_review: reviewers can see it
    fid = client.get(f"/reviews/{rid}/findings", headers=h["creator"]).json()[0]["finding_id"]
    for role in ("creator", "reviewer", "manager", "admin"):
        r = client.post(f"/reviews/{rid}/comments", headers=h[role], json={"text": f"from {role}"})
        assert r.status_code == 201 and r.json()["role"] in ("creator", "reviewer", "manager", "brand_admin")
    ok = client.post(f"/reviews/{rid}/comments", headers=h["reviewer"], json={"text": "About this one", "finding_id": fid})
    assert ok.status_code == 201 and ok.json()["finding_id"] == fid
    other = submit(client, h["creator"], title="Another")["id"]
    other_fid = client.get(f"/reviews/{other}/findings", headers=h["creator"]).json()[0]["finding_id"]
    err(client.post(f"/reviews/{rid}/comments", headers=h["reviewer"], json={"text": "x", "finding_id": other_fid}), 422, "validation_error")
    err(client.post(f"/reviews/{rid}/comments", headers=h["reviewer"], json={"text": "   "}), 422, "validation_error")
    thread = client.get(f"/reviews/{rid}/comments", headers=h["creator"]).json()
    assert [c["text"] for c in thread][:4] == ["from creator", "from reviewer", "from manager", "from admin"]
    ev = client.get(f"/reviews/{rid}/activity", headers=h["creator"]).json()
    commented = [e for e in ev if e["type"] == "comment_added"]
    assert len(commented) == 5 and commented[0]["detail"]["text"] == "from creator"


def test_request_changes_note_appears_in_the_thread(client, h):
    rid = _flow(client, h)
    client.post(f"/reviews/{rid}/request-changes", headers=h["reviewer"], json={"note": "Please re-check the claim"})
    thread = client.get(f"/reviews/{rid}/comments", headers=h["creator"]).json()
    assert thread[-1]["text"] == "Please re-check the claim" and thread[-1]["role"] == "reviewer"


def test_versions_record_each_edit(client, h):
    rid = submit(client, h["creator"], content="Meet the Zippy bottle today.")["id"]
    v = client.get(f"/reviews/{rid}/versions", headers=h["creator"]).json()
    assert [x["number"] for x in v] == [1] and v[0]["reason"] == "submitted" and v[0]["content"] == "Meet the Zippy bottle today."
    f = client.get(f"/reviews/{rid}/findings", headers=h["creator"]).json()[0]
    client.patch(f"/findings/{f['finding_id']}", headers=h["creator"], json={"action": "edited", "edited_text": "Zippy Bottle"})
    v = client.get(f"/reviews/{rid}/versions", headers=h["manager"]).json()
    assert [x["number"] for x in v] == [1, 2]
    assert v[1]["content"] == "Meet the Zippy Bottle today." and v[1]["created_by"] == "Aarav Mehta"


def test_workspace_feed_respects_visibility(client, h):
    mine = _flow(client, h)
    other = submit(client, h["creator"], title="Not escalated yet")["id"]
    feed = lambda role: client.get("/activity", headers=h[role]).json()  # noqa: E731
    assert {e["review_id"] for e in feed("manager")} == {mine, other}
    assert {e["review_id"] for e in feed("reviewer")} == {mine}                # only the in_review one
    assert all(e["review_title"] for e in feed("manager"))
    ids = [int(e["id"][2:]) for e in feed("manager")]
    assert ids == sorted(ids, reverse=True)                                    # newest first
    assert len(client.get("/activity?limit=3", headers=h["manager"]).json()) == 3
    assert client.get("/activity?limit=0", headers=h["manager"]).status_code == 422
    assert client.get("/activity").status_code == 401
