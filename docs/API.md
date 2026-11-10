# Greenlight API contract

> Fixed shapes. Backend returns exactly these; frontend expects exactly these. Changes need both of us (`docs-api-<change>` PR).

**Base URL** `http://localhost:8000` · **Format** JSON · **Auth** `Authorization: Bearer <access_token>` on everything except login
**Roles:** `creator`, `manager`, `reviewer`, `brand_admin`
**Review statuses:** `draft`, `scanned`, `resolving`, `in_review`, `approved`, `changes_requested`

### Auth

`POST /auth/login`
```json
// request
{ "email": "harshit@acme.com", "password": "secret" }

// 200
{
  "access_token": "eyJhbGciOi...",
  "token_type": "bearer",
  "user": { "id": "U-1", "name": "Harshit Verma", "role": "manager", "workspace_id": "W-1" }
}
```

### Brand Kit

`GET /brand-kit/sources?kind=guideline` (`kind`: `guideline`, `fact`, `term`, `asset`; optional)
```json
[{
  "id": "G-4.2",
  "kind": "guideline",
  "title": "Avoid unsupported superlatives",
  "text": "Do not use claims such as '#1', 'best' or 'fastest' unless an approved fact substantiates them.",
  "version": "v3",
  "status": "active"
}]
```

`POST /brand-kit/sources` (brand_admin)
```json
// request
{ "kind": "fact", "title": "Delivery coverage", "text": "Fast delivery is available in select cities." }

// 201
{ "id": "F-12", "kind": "fact", "title": "Delivery coverage",
  "text": "Fast delivery is available in select cities.", "version": "v3", "status": "active" }
```

### Reviews

`GET /reviews`
```json
[{
  "id": "CL-2084",
  "title": "Summer launch announcement",
  "creator": "Aarav Mehta",
  "status": "in_review",
  "finding_count": 3,
  "updated_at": "2026-11-02T10:42:00Z"
}]
```

`POST /reviews`
```json
// request
{ "title": "Summer launch announcement",
  "content": "We offer #1 fastest delivery, guaranteed.",
  "intent_note": "Launch email for the summer campaign" }

// 201
{ "id": "CL-2084", "status": "scanned", "finding_count": 1 }
```

`GET /reviews/{id}`
```json
{
  "id": "CL-2084",
  "title": "Summer launch announcement",
  "content": "We offer #1 fastest delivery, guaranteed.",
  "status": "in_review",
  "creator": "Aarav Mehta",
  "brand_kit_version": "v3",
  "created_at": "2026-11-02T10:00:00Z",
  "updated_at": "2026-11-02T10:42:00Z"
}
```

`GET /reviews/{id}/findings`
```json
[{
  "finding_id": "F-1042",
  "type": "unsupported_claim",
  "severity": "high",
  "span": { "start": 21, "end": 52, "text": "#1 fastest delivery, guaranteed" },
  "source": { "kind": "guideline", "id": "G-4.2", "version": "v3" },
  "fact_match": null,
  "reason": "No approved fact supports a 'fastest' claim.",
  "confidence": 0.91,
  "method": "ai_assisted",
  "suggestion": { "text": "Fast delivery is available in select cities", "fact_id": "F-12", "applied": false },
  "decision": null
}]
```
- `type`: `unsupported_claim`, `contradicted_claim`, `terminology`, `tone`, `accessibility`, `visual`
- `severity`: `high`, `medium`, `low`
- `method`: `rule_based`, `ai_assisted`
- `decision`: `null` or `{ "action": "accepted|edited|disputed", "reason": "...", "actor": "U-1" }`

`PATCH /findings/{finding_id}`
```json
// request
{ "action": "disputed", "reason": "We hold a third-party award for this claim.", "edited_text": null }

// 200
{ "finding_id": "F-1042",
  "decision": { "action": "disputed", "reason": "We hold a third-party award for this claim.", "actor": "U-1" } }
```

### Workflow

`POST /reviews/{id}/comments`: anyone who can open the review may comment.
```json
// request. finding_id is optional: the comment is about one finding of this review
{ "text": "Please confirm the delivery cities with legal.", "finding_id": "FD-1004" }

// 201
{ "id": "C-77", "author": "Harshit Verma", "role": "manager", "finding_id": "FD-1004",
  "text": "Please confirm the delivery cities with legal.", "created_at": "2026-11-02T11:05:00Z" }
```
`text` must not be blank (422). `finding_id` must belong to the same review (422).

`GET /reviews/{id}/comments` returns `CommentResponse[]`, oldest first. A reviewer's note when requesting changes is added to this thread automatically.

`POST /reviews/{id}/approve` and `POST /reviews/{id}/request-changes` (reviewer only)
```json
// request
{ "note": "Looks good after edits." }

// 200
{ "id": "CL-2084", "status": "approved" }
```

### Insights and disclosure

`GET /insights/summary`
```json
{ "reviewed_this_month": 128, "needs_attention": 8, "awaiting_approval": 12, "approved_this_month": 94,
  "top_issues": [{ "type": "unsupported_claim", "count": 31 }] }
```

`GET /insights/gaps` (brand_admin)
```json
[{ "source_id": "G-4.2", "title": "Avoid unsupported superlatives",
   "dispute_count": 9, "note": "Often disputed; may be unclear." }]
```

`GET /reviews/{id}/ai-disclosure`
```json
{ "review_id": "CL-2084",
  "steps": [
    { "step": "judge", "used_ai": true, "model": "claude", "data_sent": "1 sentence + 2 matched sources" },
    { "step": "rules", "used_ai": false }
  ] }
```

### Activity and history

`GET /reviews/{id}/activity` returns `ActivityEvent[]` for one review, **oldest first**. It uses the same visibility as the review.
```json
[
  { "id": "E-41", "type": "review_submitted", "at": "2026-11-02T10:00:00Z",
    "actor": { "id": "U-1", "name": "Aarav Mehta", "role": "creator" },
    "summary": "Submitted for review (Brand Kit v3)", "reason": "",
    "detail": { "brand_kit_version": "v3" }, "review_id": "CL-2084", "review_title": null },
  { "id": "E-42", "type": "scan_completed", "at": "2026-11-02T10:00:02Z", "actor": null,
    "summary": "Automated check finished: 3 potential issues (rules only)", "reason": "",
    "detail": { "mode": "rules_only", "findings": 3, "dropped_unverified": 0 }, "review_id": "CL-2084", "review_title": null },
  { "id": "E-45", "type": "finding_decision", "at": "2026-11-02T10:14:00Z",
    "actor": { "id": "U-1", "name": "Aarav Mehta", "role": "creator" },
    "summary": "Marked not applicable “#1”", "reason": "Approved by legal for this campaign.",
    "detail": { "finding_id": "FD-1001", "action": "disputed", "quote": "#1" }, "review_id": "CL-2084", "review_title": null }
]
```
`actor` is `null` for the system (the automated check). `type` is one of `review_submitted`, `scan_completed`, `content_edited`, `finding_decision`, `comment_added`, `status_changed`, `approved`, `changes_requested`. `summary` is ready to display. A `status_changed` event that only repeats an `approved` / `changes_requested` event is not listed twice. `comment_added` carries the comment text in `detail.text`.

`GET /activity?limit=100` returns the same events across every review the caller can see, **newest first** (`limit` 1 to 200). `review_title` is filled in here.

`GET /reviews/{id}/versions` returns `VersionResponse[]`, oldest first. Version 1 is what was submitted; each edit adds one.
```json
[ { "number": 2, "content": "Meet the Zippy Bottle today.", "reason": "Edited the flagged wording.",
    "created_by": "Aarav Mehta", "created_at": "2026-11-02T10:14:00Z" } ]
```

### Errors (same shape everywhere)

```json
{ "error": { "code": "forbidden", "message": "Only reviewers can approve." } }
```
`unauthorized` 401 · `forbidden` 403 · `not_found` 404 · `validation_error` 422 · `server_error` 500

### Permissions

| Role | Can |
|---|---|
| creator | Submit drafts, view own findings, accept/edit/dispute, comment on own reviews |
| manager | View team queue, comment, view insights (assign and escalate: planned, v6.2) |
| reviewer | View escalated items with evidence, comment, approve, request changes |
| brand_admin | Manage the Brand Kit, view guideline-gap insights, comment |

The AI has no role. It cannot approve, reject or change content.

---

---

## Conventions the backend follows (clarifications, not changes to the shapes above)

**IDs** are opaque strings: users `U-n`, workspaces `W-n`, reviews `CL-n` (from 2001), findings `FD-n` (from 1001), comments `C-n`, sources `G-`/`F-`/`T-`/`A-` + number. Source IDs are unique per workspace.

**Brand Kit versions.** Adding a source creates the next Brand Kit version (`v1`, `v2`, ...). A source's `version` is the Brand Kit version it was introduced in. A review is pinned to the Brand Kit version current when it was submitted, and findings may only cite sources that exist in that version.

**Term sources.** `title` = the wording to avoid; `text` = `Use: <preferred wording>. <optional note>`.

**Spans** are character offsets (`start` inclusive, `end` exclusive) into the review's *current* `content`. After a finding is edited, later findings' spans are shifted so they keep pointing at the same text.

**Review status flow.**
`scanned` (a scan found issues) -> `resolving` (creator is deciding) -> `in_review` (every finding is `edited` or `disputed`) -> `approved` or `changes_requested` (reviewer only). A draft with zero findings goes straight to `in_review`. `changes_requested` returns to `resolving` / `in_review` when the creator changes a decision. A finding decided `accepted` (confirmed but not fixed) still counts as unresolved. `approved` is final.
Findings can only be decided while the review is `scanned`, `resolving` or `changes_requested`.

**Validation (422 `validation_error`)**: `disputed` needs a non-empty `reason`; `edited` needs `edited_text`; `request-changes` needs a non-empty `note`; approving or requesting changes on a review that is not `in_review` is rejected. An approve/request-changes `note` is also posted to the review's comment thread.

**Visibility.** Creators see only their own reviews. Managers and brand admins see the whole workspace (brand admins read-only). Reviewers see only reviews that reached `in_review` or beyond. Everything else answers `404 not_found`. `GET /insights/summary` is scoped to the reviews the caller can see; `GET /insights/gaps` is brand_admin only.

**Rules-only mode.** If the LLM is not configured or unreachable, findings come from deterministic rules only (`method: "rule_based"`) and `GET /reviews/{id}/ai-disclosure` shows the `judge` step with `used_ai: false`. A finding with `source: null` only occurs for built-in accessibility checks (e.g. missing alt text).

**Low confidence** (`confidence < 0.6`) is labelled in `reason` and severity is capped at `medium`.

---

## Gaps found while building (NOT implemented; need both of us to agree first)

1. ~~No way to read comments.~~ **Done (v6.1):** `GET /reviews/{id}/comments`.
2. ~~No way to read the audit trail.~~ **Done (v6.1):** `GET /reviews/{id}/activity` and `GET /activity`.
3. **No escalate/assign endpoint** (planned, v6.2), although the manager role lists "assign, escalate". Today a review reaches `in_review` automatically once every finding is resolved.
4. **No `GET /auth/me`** to restore the session after a page refresh (the token alone does not carry the user's name).
5. **No re-scan after edits.** Edits are applied to the text and recorded, but findings are not re-run.

