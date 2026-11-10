"""Responses must have exactly the shapes in docs/API.md (key sets, types, status codes)."""
from conftest import submit

FINDING_KEYS = {"finding_id", "type", "severity", "span", "source", "fact_match", "reason", "confidence",
                "method", "suggestion", "decision"}


def test_login(client):
    r = client.post("/auth/login", json={"email": "harshit@acme.com", "password": "greenlight-demo"})
    assert r.status_code == 200
    b = r.json()
    assert set(b) == {"access_token", "token_type", "user"} and b["token_type"] == "bearer"
    assert set(b["user"]) == {"id", "name", "role", "workspace_id"} and b["user"]["role"] == "manager"


def test_brand_kit(client, h):
    rows = client.get("/brand-kit/sources?kind=guideline", headers=h["creator"]).json()
    assert rows and {r["kind"] for r in rows} == {"guideline"}
    assert set(rows[0]) == {"id", "kind", "title", "text", "version", "status"} and rows[0]["status"] == "active"
    r = client.post("/brand-kit/sources", headers=h["admin"],
                    json={"kind": "fact", "title": "Delivery coverage", "text": "Fast delivery is available in select cities."})
    assert r.status_code == 201 and r.json()["id"].startswith("F-") and r.json()["version"] == "v2"
    assert any(s["id"] == r.json()["id"] for s in client.get("/brand-kit/sources", headers=h["creator"]).json())


def test_reviews_and_findings(client, h):
    created = submit(client, h["creator"])
    assert set(created) == {"id", "status", "finding_count"} and created["id"].startswith("CL-")
    listing = client.get("/reviews", headers=h["creator"]).json()
    assert set(listing[0]) == {"id", "title", "creator", "status", "finding_count", "updated_at"}
    assert listing[0]["creator"] == "Aarav Mehta"
    detail = client.get(f"/reviews/{created['id']}", headers=h["creator"]).json()
    assert set(detail) == {"id", "title", "content", "status", "creator", "brand_kit_version", "created_at", "updated_at"}
    f = client.get(f"/reviews/{created['id']}/findings", headers=h["creator"]).json()[0]
    assert set(f) == FINDING_KEYS and set(f["span"]) == {"start", "end", "text"}
    assert set(f["source"]) == {"kind", "id", "version"} and set(f["suggestion"]) == {"text", "fact_id", "applied"}
    assert f["decision"] is None and f["fact_match"] is None and isinstance(f["confidence"], float)


def test_patch_finding_and_workflow(client, h):
    rid = submit(client, h["creator"])["id"]
    fid = client.get(f"/reviews/{rid}/findings", headers=h["creator"]).json()[0]["finding_id"]
    r = client.patch(f"/findings/{fid}", headers=h["creator"],
                     json={"action": "disputed", "reason": "We hold a third-party award for this claim.", "edited_text": None})
    assert r.json() == {"finding_id": fid, "decision": {"action": "disputed", "reason": "We hold a third-party award for this claim.", "actor": "U-1"}}
    c = client.post(f"/reviews/{rid}/comments", headers=h["manager"], json={"text": "Please confirm the cities with legal."})
    assert c.status_code == 201 and set(c.json()) == {"id", "author", "role", "text", "created_at", "finding_id"} and c.json()["author"] == "Harshit Verma"
    a = client.post(f"/reviews/{rid}/approve", headers=h["reviewer"], json={"note": "Looks good after edits."})
    assert a.json() == {"id": rid, "status": "approved"}


def test_insights(client, h):
    rid = submit(client, h["creator"])["id"]
    s = client.get("/insights/summary", headers=h["manager"]).json()
    assert set(s) == {"reviewed_this_month", "needs_attention", "awaiting_approval", "approved_this_month", "top_issues"}
    assert s["reviewed_this_month"] == 1 and s["needs_attention"] == 1 and s["top_issues"][0] == {"type": "unsupported_claim", "count": 1}
    fid = client.get(f"/reviews/{rid}/findings", headers=h["creator"]).json()[0]["finding_id"]
    client.patch(f"/findings/{fid}", headers=h["creator"], json={"action": "disputed", "reason": "Award"})
    gaps = client.get("/insights/gaps", headers=h["admin"]).json()
    assert set(gaps[0]) == {"source_id", "title", "dispute_count", "note"} and gaps[0]["source_id"] == "G-4.2" and gaps[0]["dispute_count"] == 1


def test_summary_is_scoped_to_what_the_caller_may_see(client, h):
    submit(client, h["creator"])
    assert client.get("/insights/summary", headers=h["reviewer"]).json()["reviewed_this_month"] == 0
    assert client.get("/insights/summary", headers=h["creator"]).json()["reviewed_this_month"] == 1


def test_cors_allows_only_the_frontend_origin(client):
    ok = client.options("/reviews", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET",
                                             "Access-Control-Request-Headers": "authorization"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
    bad = client.options("/reviews", headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in bad.headers


def test_unknown_route_and_server_errors_use_the_error_shape(client):
    r = client.get("/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
