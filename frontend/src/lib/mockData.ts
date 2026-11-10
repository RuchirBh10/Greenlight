/**
 * Mock backend in the exact shape of the contract (docs/API.md). Used when NEXT_PUBLIC_USE_MOCK=true.
 *
 * It is stateful (kept in localStorage) and enforces the same rules as the real service:
 *   - only creators submit drafts and resolve their own findings
 *   - only reviewers approve / request changes, and only on `in_review` items
 *   - a review reaches `in_review` only when every finding is edited or disputed
 *   - creators see their own reviews, reviewers see escalated ones, managers/brand admins see all
 * so a screen that works on the mock works on the live backend. Fictional brand and people only.
 */
import type {
  ActivityEvent, ActivityEventType, AiDisclosure, ApiFinding, ApiSeverity, ApiUser, BrandSource, CommentResponse, EscalationResponse,
  FindingAction, FindingType, InsightGap, InsightsSummary, LoginResponse, Person, ReviewApiStatus, ReviewDetail, ReviewListItem,
  SourceKind, UserRole, VersionResponse,
} from "@/types/contract";
import { ApiError } from "./api-error";

const ROLE_NOUN: Record<string, string> = { manager: "manager", brand_admin: "brand admin" };

const DB_KEY = "greenlight-mock-db-v3";
export const MOCK_PASSWORD = "greenlight-demo";
const LATENCY_MS = 120;

type MockUser = ApiUser & { email: string };
export const MOCK_USERS: MockUser[] = [
  { id: "U-1", name: "Aarav Mehta", email: "aarav@acme.com", role: "creator", workspace_id: "W-1" },
  { id: "U-2", name: "Harshit Verma", email: "harshit@acme.com", role: "manager", workspace_id: "W-1" },
  { id: "U-3", name: "Priya Nair", email: "priya@acme.com", role: "reviewer", workspace_id: "W-1" },
  { id: "U-4", name: "Ruchir Bharadwaj", email: "ruchir@acme.com", role: "brand_admin", workspace_id: "W-1" },
];
const userById = (id: string) => MOCK_USERS.find(u => u.id === id);

interface StoredSource extends BrandSource { kitVersion: number }
interface Decision { action: FindingAction; reason: string; actor: string; editedText?: string | null }
interface StoredFinding extends Omit<ApiFinding, "decision"> { reviewId: string; decisions: Decision[] }
interface StoredVersion { content: string; reason: string; createdBy: string | null; createdAt: string }
interface StoredEscalation {
  id: string; reviewId: string; raisedBy: string; toRole: "manager" | "brand_admin"; reason: string; status: "open" | "resolved";
  createdAt: string; resolvedBy: string | null; resolvedAt: string | null; resolution: string;
}
interface StoredReview {
  id: string; title: string; creatorId: string; assigneeId: string | null; status: ReviewApiStatus; kitVersion: number;
  versions: StoredVersion[]; createdAt: string; updatedAt: string; decidedAt: string | null;
}
interface StoredEvent { pk: number; reviewId: string; type: ActivityEventType; actorId: string | null; detail: Record<string, unknown>; reason: string; at: string }
interface StoredComment { id: string; reviewId: string; authorId: string; findingId: string | null; text: string; at: string }
interface Db {
  kitVersion: number; sources: StoredSource[]; reviews: StoredReview[]; findings: StoredFinding[];
  events: StoredEvent[]; comments: StoredComment[]; escalations: StoredEscalation[];
  seq: { review: number; finding: number; comment: number; event: number; escalation: number; source: Record<string, number> };
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const plus = (iso: string, seconds: number) => new Date(+new Date(iso) + seconds * 1000).toISOString();

// ---- error helpers ------------------------------------------------------------------------------
const fail = (status: number, code: string, message: string) =>
  new ApiError(message, status, { error: { code, message } });
const unauthorized = (m = "Authentication required.") => fail(401, "unauthorized", m);
const forbidden = (m = "You do not have permission to do this.") => fail(403, "forbidden", m);
const notFound = (m = "Not found.") => fail(404, "not_found", m);
const invalid = (m = "Invalid request.") => fail(422, "validation_error", m);

// ---- detection (a small, honest stand-in for the backend's rules step) --------------------------
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CLAIMS = /#\s?1\b|\bno\.?\s?1\b|\bnumber\s+one\b|\b(?:the\s+)?best(?:-selling)?\b|\bfastest\b|\bguaranteed?\b|\b100\s?%\b|\bzero[- ]risk\b|\bclinically\s+proven\b|\bcarbon[- ]neutral\b|\bmarket[- ]lead(?:er|ers|ing)\b|\bindustry[- ]lead(?:er|ers|ing)\b|\btop[- ]ranked\b/gi;
const URGENCY = /!{2,}|\b(?:don['’]t miss out|miss out|act now|hurry|last chance|limited time only)\b/gi;
const SHOUTING = /\b[A-Z]{5,}\b/g;
const IMAGE_REF = /\b[\w-]+\.(?:png|jpe?g|gif|webp)\b|\[image\]/gi;

interface Hit { type: FindingType; severity: ApiSeverity; start: number; end: number; text: string; source: StoredSource | null; reason: string; confidence: number; suggestion: ApiFinding["suggestion"] }

function parseTerm(s: StoredSource): { avoid: string; use: string | null; note: string } {
  const m = /^\s*use\s*[:\-–]?\s*["“'‘]?([^"”'’.;—–]+?)["”'’]?\s*(?:[.;—–]\s*([\s\S]*))?$/i.exec(s.text);
  return { avoid: s.title, use: m ? m[1].trim() : null, note: m?.[2]?.trim() ?? "" };
}

function detect(text: string, kit: StoredSource[]): Hit[] {
  const hits: Hit[] = [];
  const taken: Array<[number, number]> = [];
  const guideline = (...keys: string[]) => kit.find(s => s.kind === "guideline" && keys.some(k => `${s.title} ${s.text}`.toLowerCase().includes(k))) ?? null;
  const add = (h: Hit) => {
    if (taken.some(([a, b]) => h.start < b && h.end > a)) return;
    taken.push([h.start, h.end]);
    hits.push(h);
  };

  for (const m of text.matchAll(CLAIMS)) {
    const start = m.index ?? 0;
    // Extend a claim over the rest of its phrase so the flagged span reads naturally.
    const tail = /^[\w\s,'’-]{0,30}?(?:guaranteed|delivery|shipping|quality)?[\w,'’-]*/i.exec(text.slice(start + m[0].length))?.[0] ?? "";
    const span = (m[0] + tail).replace(/[\s,]+$/, "");
    const fact = /deliver|fast|ship/i.test(span) ? kit.find(s => s.kind === "fact" && /deliver/i.test(`${s.title} ${s.text}`)) : undefined;
    add({
      type: "unsupported_claim", severity: "high", start, end: start + span.length, text: span,
      source: guideline("superlative", "claim"),
      reason: "No approved fact supports this claim. It is unsupported, not proven false.", confidence: 0.91,
      suggestion: fact ? { text: fact.text.replace(/\.$/, ""), fact_id: fact.id, applied: false } : null,
    });
  }
  for (const m of text.matchAll(URGENCY)) {
    const start = m.index ?? 0;
    add({ type: "tone", severity: "medium", start, end: start + m[0].length, text: m[0], source: guideline("tone", "pressure"),
      reason: "Pressure language or repeated exclamation marks conflict with the helpful, confident brand voice.", confidence: 0.86, suggestion: null });
  }
  for (const t of kit.filter(s => s.kind === "term")) {
    const { avoid, use, note } = parseTerm(t);
    if (!avoid.trim()) continue;
    for (const m of text.matchAll(new RegExp(`\\b${esc(avoid.trim())}\\b`, "gi"))) {
      if (use && m[0] === use) continue;
      const start = m.index ?? 0;
      add({ type: "terminology", severity: "medium", start, end: start + m[0].length, text: m[0], source: t,
        reason: `“${m[0]}” does not match the approved terminology.${note ? ` ${note}` : ""}`, confidence: 0.97,
        suggestion: use ? { text: use, fact_id: null, applied: false } : null });
    }
  }
  if (!/alt\s*text\s*:/i.test(text)) {
    for (const m of text.matchAll(IMAGE_REF)) {
      const start = m.index ?? 0;
      add({ type: "accessibility", severity: "low", start, end: start + m[0].length, text: m[0], source: guideline("alt text", "accessib"),
        reason: "An image is referenced without descriptive alt text in the submitted copy.", confidence: 0.94, suggestion: null });
    }
  }
  for (const m of text.matchAll(SHOUTING)) {
    const start = m.index ?? 0;
    add({ type: "tone", severity: "low", start, end: start + m[0].length, text: m[0], source: guideline("tone"),
      reason: "All-caps words read as shouting and conflict with the calm, confident voice.", confidence: 0.8,
      suggestion: { text: m[0].charAt(0) + m[0].slice(1).toLowerCase(), fact_id: null, applied: false } });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return hits.sort((a, b) => rank[a.severity] - rank[b.severity] || a.start - b.start);
}

// ---- database -----------------------------------------------------------------------------------
const src = (id: string, kind: SourceKind, title: string, text: string, kitVersion = 1): StoredSource =>
  ({ id, kind, title, text, version: `v${kitVersion}`, status: "active", kitVersion });

function emptyDb(): Db {
  return {
    kitVersion: 3, reviews: [], findings: [], events: [], comments: [], escalations: [],
    seq: { review: 2001, finding: 1001, comment: 1, event: 1, escalation: 1, source: { guideline: 6, fact: 22, term: 11, asset: 2 } },
    sources: [
      src("G-4.2", "guideline", "Avoid unsupported superlatives", "Do not use claims such as '#1', 'best' or 'fastest' unless an approved fact substantiates them."),
      src("G-2.1", "guideline", "Use a helpful, confident tone", "Be clear and reassuring in the brand voice. Avoid pressure tactics, excessive exclamation marks and fear-based language."),
      src("G-5.1", "guideline", "Accessibility basics", "Every image needs descriptive alt text, link text must make sense on its own, and text needs WCAG AA contrast."),
      src("F-12", "fact", "Delivery coverage", "Fast delivery is available in select cities.", 2),
      src("F-18", "fact", "Bottle capacity", "The Zippy Bottle has a 750 ml capacity.", 2),
      src("F-21", "fact", "Material", "Made with BPA-free, food-grade stainless steel.", 2),
      src("T-8", "term", "Zippy bottle", "Use: Zippy Bottle. Approved product name and capitalisation.", 3),
      src("T-9", "term", "Cheap", "Use: Affordable. Preferred value-proposition language.", 3),
      src("T-10", "term", "Best ever", "Use: Reliable. Superlatives need an approved fact.", 3),
      src("A-1", "asset", "Brand palette", "Approved colours: Primary #315CE8, Ink #111827, Accent #A5B4FC, Canvas #F6F7FB.", 3),
    ],
  };
}

// ---- the workflow itself: shared by the request handlers and the demo seed, so both behave identically -------
const REVIEWER_VISIBLE: ReviewApiStatus[] = ["in_review", "approved", "changes_requested"];
const EDITABLE: ReviewApiStatus[] = ["scanned", "resolving", "changes_requested"];
const TRANSITIONS: Record<ReviewApiStatus, ReviewApiStatus[]> = {
  draft: ["scanned"], scanned: ["resolving", "in_review"], resolving: ["resolving", "in_review"],
  in_review: ["approved", "changes_requested"], changes_requested: ["resolving", "in_review"], approved: [],
};
const content = (r: StoredReview) => r.versions[r.versions.length - 1].content;
const latest = (f: StoredFinding) => f.decisions[f.decisions.length - 1] ?? null;
const unresolved = (db: Db, id: string) => db.findings.filter(f => f.reviewId === id && (latest(f) === null || latest(f)!.action === "accepted")).length;

function record(db: Db, reviewId: string, type: ActivityEventType, actorId: string | null, detail: Record<string, unknown> = {}, reason = "", at = new Date().toISOString()) {
  db.events.push({ pk: db.seq.event++, reviewId, type, actorId, detail, reason, at });
}
/** An approval or change request is recorded as its own event, so the matching status change is not stored twice. */
function transition(db: Db, r: StoredReview, to: ReviewApiStatus, actorId: string | null, reason = "", at = new Date().toISOString()) {
  if (!TRANSITIONS[r.status].includes(to)) throw invalid(`A review cannot move from ${r.status} to ${to}.`);
  if (r.status !== to && to !== "approved" && to !== "changes_requested") record(db, r.id, "status_changed", actorId, { from: r.status, to }, reason, at);
  r.status = to;
  r.updatedAt = at;
}

function submit(db: Db, userId: string, title: string, text: string, at = new Date().toISOString()): StoredReview {
  const id = `CL-${db.seq.review++}`;
  const review: StoredReview = { id, title, creatorId: userId, assigneeId: null, status: "draft", kitVersion: db.kitVersion,
    versions: [{ content: text, reason: "submitted", createdBy: userId, createdAt: at }], createdAt: at, updatedAt: at, decidedAt: null };
  db.reviews.push(review);
  record(db, id, "review_submitted", userId, { brand_kit_version: `v${db.kitVersion}` }, "", at);
  const hits = detect(text, db.sources);
  for (const h of hits) {
    db.findings.push({
      finding_id: `FD-${db.seq.finding++}`, reviewId: id, type: h.type, severity: h.severity,
      span: { start: h.start, end: h.end, text: h.text },
      source: h.source ? { kind: h.source.kind, id: h.source.id, version: h.source.version } : null,
      fact_match: null, reason: h.reason, confidence: h.confidence, method: "rule_based", suggestion: h.suggestion, decisions: [],
    });
  }
  const done = plus(at, 2);
  record(db, id, "scan_completed", null, { mode: "rules_only", findings: hits.length, dropped_unverified: 0 }, "", done);
  transition(db, review, "scanned", null, "scan finished", done);
  if (!hits.length) transition(db, review, "in_review", null, "no findings to resolve", done);
  return review;
}

interface DecisionInput { action: FindingAction; reason: string; editedText: string | null }
/** Applies one creator decision to a finding. Validation of who may do it stays in the request handler. */
function decide(db: Db, r: StoredReview, f: StoredFinding, actor: MockUser, input: DecisionInput, at = new Date().toISOString()): Decision {
  let reason = input.reason.trim();
  if (input.action === "edited") {
    const edited = input.editedText;
    if (!edited || !edited.trim()) throw invalid("edited_text is required when action is 'edited'.");
    const current = content(r);
    if (current.slice(f.span.start, f.span.end) !== f.span.text) throw invalid("The flagged text has changed; reload the review.");
    const delta = edited.length - (f.span.end - f.span.start);
    reason = reason || "Edited the flagged wording.";
    r.versions.push({ content: current.slice(0, f.span.start) + edited + current.slice(f.span.end), reason, createdBy: actor.id, createdAt: at });
    for (const o of db.findings) if (o.reviewId === r.id && o !== f && o.span.start >= f.span.end) o.span = { ...o.span, start: o.span.start + delta, end: o.span.end + delta };
    f.span = { start: f.span.start, end: f.span.start + edited.length, text: edited };
    if (f.suggestion) f.suggestion = { ...f.suggestion, applied: edited === f.suggestion.text };
    record(db, r.id, "content_edited", actor.id, { finding_id: f.finding_id, version: r.versions.length }, reason, at);
  }
  const decision: Decision = { action: input.action, reason, actor: actor.id, editedText: input.action === "edited" ? input.editedText : null };
  f.decisions.push(decision);
  record(db, r.id, "finding_decision", actor.id, { finding_id: f.finding_id, action: input.action }, reason, at);
  const done = unresolved(db, r.id) === 0;
  transition(db, r, done ? "in_review" : "resolving", actor.id, done ? "all findings resolved" : "", at);
  return decision;
}

function comment(db: Db, r: StoredReview, author: MockUser, text: string, findingId: string | null = null, at = new Date().toISOString(), logEvent = true): StoredComment {
  const c: StoredComment = { id: `C-${db.seq.comment++}`, reviewId: r.id, authorId: author.id, findingId, text, at };
  db.comments.push(c);
  if (logEvent) record(db, r.id, "comment_added", author.id, { comment_id: c.id, ...(findingId ? { finding_id: findingId } : {}) }, "", at);
  return c;
}

/** A reviewer's decision. A note is also added to the discussion thread so the creator sees it there. */
function conclude(db: Db, r: StoredReview, reviewer: MockUser, outcome: "approved" | "changes_requested", note: string, at = new Date().toISOString()) {
  transition(db, r, outcome, reviewer.id, note, at);
  r.decidedAt = outcome === "approved" ? at : null;
  record(db, r.id, outcome, reviewer.id, {}, note, at);
  if (note) comment(db, r, reviewer, note, null, at, false);
}

const personOf = (id: string): Person => ({ id, name: userById(id)?.name ?? "Unknown" });
const toEscalation = (e: StoredEscalation): EscalationResponse => ({
  id: e.id, review_id: e.reviewId, raised_by: personOf(e.raisedBy), to_role: e.toRole, reason: e.reason, status: e.status,
  created_at: e.createdAt, resolved_by: e.resolvedBy ? personOf(e.resolvedBy) : null, resolved_at: e.resolvedAt, resolution: e.resolution,
});
const openEscalation = (db: Db, reviewId: string) => db.escalations.find(e => e.reviewId === reviewId && e.status === "open");
const routing = (db: Db, r: StoredReview) => {
  const open = openEscalation(db, r.id);
  return { assignee: r.assigneeId ? personOf(r.assigneeId) : null, open_escalation: open ? toEscalation(open) : null };
};

/** Reviewer assignment. Passing null removes the assignee. Repeating the same assignment records nothing. */
function assignReviewer(db: Db, r: StoredReview, by: MockUser, reviewerId: string | null, note = "", at = new Date().toISOString()) {
  const target = reviewerId ? userById(reviewerId) : undefined;
  if (reviewerId && (!target || target.role !== "reviewer")) throw invalid("reviewer_id must be a reviewer in this workspace.");
  if (r.assigneeId === (target?.id ?? null)) return;
  r.assigneeId = target?.id ?? null;
  r.updatedAt = at;
  record(db, r.id, "review_assigned", by.id, { assignee_id: target?.id ?? null, assignee: target?.name ?? null }, note, at);
}
function escalateReview(db: Db, r: StoredReview, by: MockUser, toRole: "manager" | "brand_admin", reason: string, at = new Date().toISOString()): StoredEscalation {
  const e: StoredEscalation = { id: `ES-${db.seq.escalation++}`, reviewId: r.id, raisedBy: by.id, toRole, reason, status: "open", createdAt: at, resolvedBy: null, resolvedAt: null, resolution: "" };
  db.escalations.push(e);
  r.updatedAt = at;
  record(db, r.id, "review_escalated", by.id, { escalation_id: e.id, to_role: toRole }, reason, at);
  comment(db, r, by, `Escalated to ${ROLE_NOUN[toRole]}: ${reason}`, null, at, false);
  return e;
}
function resolveEscalationOf(db: Db, r: StoredReview, e: StoredEscalation, by: MockUser, resolution: string, at = new Date().toISOString()) {
  e.status = "resolved"; e.resolvedBy = by.id; e.resolvedAt = at; e.resolution = resolution;
  r.updatedAt = at;
  record(db, r.id, "escalation_resolved", by.id, { escalation_id: e.id }, resolution, at);
  comment(db, r, by, `Escalation resolved: ${resolution}`, null, at, false);
}

function seedDb(): Db {
  const db = emptyDb();
  const [aarav, harshit, priya] = [MOCK_USERS[0], MOCK_USERS[1], MOCK_USERS[2]];
  const wait = (minutesAgo: number, offsetSeconds: number) => plus(ago(minutesAgo), offsetSeconds);

  // 1. Unresolved: a manager has already left a note.
  const risky = submit(db, aarav.id, "Summer launch announcement",
    "Introducing the all-new Zippy bottle.\n\nIndia's #1 fastest delivery, guaranteed.\n\nGrab one today, or miss out!!!\n\nImage: banner.png", ago(190));
  comment(db, risky, harshit, "Please confirm the delivery cities with legal before this goes out.", null, ago(60));
  risky.updatedAt = ago(60);

  // 2. Resolved and waiting for a reviewer.
  const ready = submit(db, aarav.id, "Product feature email",
    "Hi there,\n\nMeet the Zippy bottle — made with BPA-free, food-grade stainless steel.\n\nIt ships this week.", ago(330));
  db.findings.filter(f => f.reviewId === ready.id).forEach((f, i) =>
    decide(db, ready, f, aarav, { action: "edited", reason: "", editedText: "Zippy Bottle" }, wait(300, i * 40)));

  assignReviewer(db, ready, harshit, priya.id, "Priya knows this product line.", ago(110));

  // 3. Approved by a reviewer.
  const done = submit(db, aarav.id, "October product update",
    "October product update\n\nThe Zippy Bottle has a 750 ml capacity. Fast delivery is available in select cities.", ago(1800));
  conclude(db, done, priya, "approved", "Verified against F-18 and F-12.", ago(1500));

  // 4. Sent back: the creator disputed everything, the reviewer wanted legal sign-off.
  const bounced = submit(db, aarav.id, "Back-to-school banner",
    "Back to school with the Zippy Bottle.\n\nOur best ever bottle, in the best colours.\n\nImage: school-banner.png", ago(2600));
  db.findings.filter(f => f.reviewId === bounced.id).forEach((f, i) =>
    decide(db, bounced, f, aarav, { action: "disputed", reason: "Approved by legal for this campaign.", editedText: null }, wait(2500, i * 40)));
  conclude(db, bounced, priya, "changes_requested", "Disputes need a written legal sign-off. Please attach it.", ago(2200));

  // 5. In review, but the reviewer is not sure the claim is covered: escalated to a brand admin.
  const green = submit(db, aarav.id, "Sustainability announcement",
    "Our new bottle is carbon-neutral and made with 100% recycled steel.", ago(400));
  db.findings.filter(f => f.reviewId === green.id).forEach((f, i) =>
    decide(db, green, f, aarav, { action: "disputed", reason: "Sustainability team confirmed both statements.", editedText: null }, wait(380, i * 40)));
  escalateReview(db, green, priya, "brand_admin", "Is there an approved fact for the carbon-neutral claim? I can't find one in the Brand Kit.", ago(90));
  return db;
}

let cache: Db | null = null;
function load(): Db {
  if (cache) return cache;
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(DB_KEY) : null;
    if (raw) { cache = JSON.parse(raw) as Db; return cache; }
  } catch { /* fall through to a fresh seed */ }
  cache = seedDb();
  save();
  return cache;
}
function save() {
  try { if (cache && typeof window !== "undefined") window.localStorage.setItem(DB_KEY, JSON.stringify(cache)); } catch { /* quota / private mode */ }
}
/** Restores the demo workspace (used by Settings → Reset demo data). */
export function resetMockDb(): void {
  cache = seedDb();
  save();
}

// ---- visibility and read models ----------------------------------------------------------------
const canView = (u: MockUser, r: StoredReview) =>
  u.role === "creator" ? r.creatorId === u.id : u.role === "reviewer" ? REVIEWER_VISIBLE.includes(r.status) : true;
function reviewFor(db: Db, u: MockUser, id: string): StoredReview {
  const r = db.reviews.find(x => x.id === id);
  if (!r || !canView(u, r)) throw notFound("Review not found.");
  return r;
}
const toFinding = (f: StoredFinding): ApiFinding => {
  const { reviewId: _r, decisions: _d, ...rest } = f; void _r; void _d;
  const d = latest(f);
  return { ...rest, decision: d ? { action: d.action, reason: d.reason, actor: d.actor } : null };
};

const STATUS_LABEL: Record<string, string> = { draft: "draft", scanned: "needs attention", resolving: "being resolved", in_review: "in review",
  changes_requested: "changes requested", approved: "approved" };
const VERB: Record<string, string> = { accepted: "Confirmed", edited: "Edited", disputed: "Marked not applicable" };

/** Same wording as the server's activity summaries, so the demo reads exactly like the live product. */
function summarise(e: StoredEvent, quote?: string): string {
  const d = e.detail;
  switch (e.type) {
    case "review_submitted": return d.brand_kit_version ? `Submitted for review (${d.brand_kit_version})` : "Submitted for review";
    case "scan_completed": { const n = Number(d.findings ?? 0); return `Automated check finished: ${n} potential issue${n === 1 ? "" : "s"} (${d.mode === "rules_only" ? "rules only" : "full check"})`; }
    case "content_edited": return `Edited the draft (version ${d.version ?? "?"})`;
    case "finding_decision": return quote ? `${VERB[String(d.action)] ?? "Updated"} “${quote}”` : `${VERB[String(d.action)] ?? "Updated"} a finding`;
    case "comment_added": return "Commented";
    case "approved": return "Approved for publication";
    case "changes_requested": return "Requested changes";
    case "review_assigned": return d.assignee ? `Assigned to ${d.assignee}` : "Removed the assigned reviewer";
    case "review_escalated": return `Escalated to ${d.to_role === "brand_admin" ? "a brand admin" : "a manager"}`;
    case "escalation_resolved": return "Resolved the escalation";
    case "status_changed": return `Status changed from ${STATUS_LABEL[String(d.from)] ?? d.from} to ${STATUS_LABEL[String(d.to)] ?? d.to}`;
  }
}
function toActivity(db: Db, rows: StoredEvent[], titles?: Map<string, string>): ActivityEvent[] {
  return rows.map(e => {
    const finding = db.findings.find(f => f.finding_id === e.detail.finding_id);
    const text = db.comments.find(c => c.id === e.detail.comment_id)?.text;
    const u = e.actorId ? userById(e.actorId) : undefined;
    return {
      id: `E-${e.pk}`, type: e.type, at: e.at,
      actor: u ? { id: u.id, name: u.name, role: u.role } : null,
      summary: summarise(e, finding?.span.text), reason: e.reason,
      detail: { ...e.detail, ...(finding ? { quote: finding.span.text } : {}), ...(text ? { text } : {}) },
      review_id: e.reviewId, review_title: titles?.get(e.reviewId) ?? null,
    };
  });
}
const toComment = (c: StoredComment): CommentResponse => {
  const u = userById(c.authorId)!;
  return { id: c.id, author: u.name, role: u.role as UserRole, text: c.text, created_at: c.at, finding_id: c.findingId };
};

// ---- request router -----------------------------------------------------------------------------
export async function mockRequest<T>(path: string, init: RequestInit = {}, token: string | null = null): Promise<T> {
  await new Promise(r => setTimeout(r, LATENCY_MS));
  const method = (init.method ?? "GET").toUpperCase();
  const body = (init.body ? JSON.parse(String(init.body)) : {}) as Record<string, unknown>;
  const [route, query = ""] = path.split("?");
  const db = load();

  if (route === "/auth/login" && method === "POST") {
    const user = MOCK_USERS.find(u => u.email === String(body.email ?? "").trim().toLowerCase());
    if (!user || body.password !== MOCK_PASSWORD) throw unauthorized("Incorrect email or password.");
    const { email: _e, ...publicUser } = user; void _e;
    const out: LoginResponse = { access_token: `mock.${user.id}`, token_type: "bearer", user: publicUser };
    return out as T;
  }

  const user = token?.startsWith("mock.") ? userById(token.slice(5)) : undefined;
  if (!user) throw unauthorized();
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  let out: unknown;
  let m: RegExpExecArray | null;

  if (route === "/brand-kit/sources") {
    if (method === "POST") {
      if (user.role !== "brand_admin") throw forbidden("Only brand admins can change the Brand Kit.");
      const kind = body.kind as SourceKind;
      const title = text(body.title).trim(), t = text(body.text).trim();
      if (!["guideline", "fact", "term", "asset"].includes(kind)) throw invalid("kind: invalid value");
      if (!title || !t) throw invalid("title and text are required.");
      db.kitVersion += 1;
      const prefix = { guideline: "G", fact: "F", term: "T", asset: "A" }[kind];
      const n = db.seq.source[kind]++;
      const created = src(`${prefix}-${n}`, kind, title, t, db.kitVersion);
      db.sources.push(created);
      out = { id: created.id, kind, title, text: t, version: created.version, status: "active" } satisfies BrandSource;
    } else {
      const kind = new URLSearchParams(query).get("kind");
      out = db.sources.filter(s => !kind || s.kind === kind).map(({ kitVersion: _k, ...s }) => { void _k; return s; });
    }
  } else if (route === "/reviews" && method === "POST") {
    if (user.role !== "creator") throw forbidden("Only creators can submit drafts.");
    const title = text(body.title).trim(), draft = text(body.content);
    if (!title) throw invalid("title: field required");
    if (!draft.trim()) throw invalid("content: field required");
    const r = submit(db, user.id, title, draft);
    out = { id: r.id, status: r.status, finding_count: db.findings.filter(f => f.reviewId === r.id).length };
  } else if (route === "/reviews") {
    const rows = db.reviews.filter(r => canView(user, r)).sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
    out = rows.map(r => ({
      id: r.id, title: r.title, creator: userById(r.creatorId)?.name ?? "Unknown", status: r.status,
      finding_count: db.findings.filter(f => f.reviewId === r.id).length, ...routing(db, r), updated_at: r.updatedAt,
    } satisfies ReviewListItem));
  } else if ((m = /^\/reviews\/([^/]+)$/.exec(route))) {
    const r = reviewFor(db, user, decodeURIComponent(m[1]));
    out = { id: r.id, title: r.title, content: content(r), status: r.status, creator: userById(r.creatorId)?.name ?? "Unknown",
      brand_kit_version: `v${r.kitVersion}`, ...routing(db, r), created_at: r.createdAt, updated_at: r.updatedAt } satisfies ReviewDetail;
  } else if ((m = /^\/reviews\/([^/]+)\/findings$/.exec(route))) {
    const r = reviewFor(db, user, decodeURIComponent(m[1]));
    const rank = { high: 0, medium: 1, low: 2 };
    out = db.findings.filter(f => f.reviewId === r.id).sort((a, b) => rank[a.severity] - rank[b.severity] || a.span.start - b.span.start).map(toFinding);
  } else if ((m = /^\/findings\/([^/]+)$/.exec(route)) && method === "PATCH") {
    const f = db.findings.find(x => x.finding_id === decodeURIComponent(m![1]));
    const r = f && db.reviews.find(x => x.id === f.reviewId);
    if (!f || !r) throw notFound("Finding not found.");
    if (user.role !== "creator" || r.creatorId !== user.id) throw forbidden("Only the creator of this review can accept, edit or dispute its findings.");
    if (!EDITABLE.includes(r.status)) throw invalid(`Findings cannot be changed while the review is ${r.status}.`);
    const action = body.action as FindingAction;
    if (!["accepted", "edited", "disputed"].includes(action)) throw invalid("action: invalid value");
    if (action === "disputed" && !text(body.reason).trim()) throw invalid("A reason is required to dispute a finding.");
    const d = decide(db, r, f, user, { action, reason: text(body.reason), editedText: typeof body.edited_text === "string" ? body.edited_text : null });
    out = { finding_id: f.finding_id, decision: { action: d.action, reason: d.reason, actor: d.actor } };
  } else if ((m = /^\/reviews\/([^/]+)\/comments$/.exec(route))) {
    const r = reviewFor(db, user, decodeURIComponent(m[1]));
    if (method === "POST") {
      const t = text(body.text).trim();
      if (!t) throw invalid("text must not be blank");
      const findingId = typeof body.finding_id === "string" ? body.finding_id : null;
      if (findingId && !db.findings.some(f => f.finding_id === findingId && f.reviewId === r.id)) throw invalid("finding_id does not belong to this review.");
      out = toComment(comment(db, r, user, t, findingId));
    } else {
      out = db.comments.filter(c => c.reviewId === r.id).map(toComment);
    }
  } else if ((m = /^\/reviews\/([^/]+)\/activity$/.exec(route))) {
    const r = reviewFor(db, user, decodeURIComponent(m[1]));
    out = toActivity(db, db.events.filter(e => e.reviewId === r.id));
  } else if ((m = /^\/reviews\/([^/]+)\/versions$/.exec(route))) {
    const r = reviewFor(db, user, decodeURIComponent(m[1]));
    out = r.versions.map((v, i): VersionResponse => ({ number: i + 1, content: v.content, reason: v.reason, created_by: v.createdBy ? userById(v.createdBy)?.name ?? null : null, created_at: v.createdAt }));
  } else if (route === "/activity") {
    const limit = Number(new URLSearchParams(query).get("limit") ?? 100);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw invalid("limit must be between 1 and 200.");
    const visible = new Map(db.reviews.filter(r => canView(user, r)).map(r => [r.id, r.title]));
    out = toActivity(db, db.events.filter(e => visible.has(e.reviewId)).sort((a, b) => b.pk - a.pk).slice(0, limit), visible);
  } else if (route === "/team/reviewers") {
    if (!["manager", "brand_admin"].includes(user.role)) throw forbidden("Only managers and brand admins can see who can be assigned.");
    out = MOCK_USERS.filter(u => u.role === "reviewer").map(u => ({ id: u.id, name: u.name, role: u.role }));
  } else if ((m = /^\/reviews\/([^/]+)\/assign$/.exec(route)) && method === "POST") {
    if (!["manager", "brand_admin"].includes(user.role)) throw forbidden("Only managers and brand admins can assign a reviewer.");
    const r = reviewFor(db, user, decodeURIComponent(m[1]));
    if (r.status === "approved") throw invalid("An approved review cannot be reassigned.");
    assignReviewer(db, r, user, typeof body.reviewer_id === "string" ? body.reviewer_id : null, text(body.note).trim());
    out = { review_id: r.id, assignee: r.assigneeId ? personOf(r.assigneeId) : null };
  } else if ((m = /^\/reviews\/([^/]+)\/escalate$/.exec(route)) && method === "POST") {
    if (user.role !== "reviewer") throw forbidden("Only reviewers can escalate a review.");
    const r = reviewFor(db, user, decodeURIComponent(m[1]));
    if (r.status !== "in_review") throw invalid(`Only reviews that are in_review can be escalated (this one is ${r.status}).`);
    if (r.assigneeId && r.assigneeId !== user.id) throw forbidden("This review is assigned to another reviewer.");
    if (openEscalation(db, r.id)) throw invalid("This review already has an open escalation.");
    const toRole = body.to_role;
    if (toRole !== "manager" && toRole !== "brand_admin") throw invalid("to_role: must be manager or brand_admin");
    const reason = text(body.reason).trim();
    if (!reason) throw invalid("reason: must not be blank");
    out = toEscalation(escalateReview(db, r, user, toRole, reason));
  } else if ((m = /^\/reviews\/([^/]+)\/escalations\/([^/]+)\/resolve$/.exec(route)) && method === "POST") {
    const r = reviewFor(db, user, decodeURIComponent(m[1]));
    const e = db.escalations.find(x => x.id === decodeURIComponent(m![2]) && x.reviewId === r.id);
    if (!e) throw notFound("Escalation not found.");
    if (e.status !== "open") throw invalid("This escalation is already resolved.");
    if (user.role !== e.toRole) throw forbidden(`Only a ${ROLE_NOUN[e.toRole]} can resolve this escalation.`);
    const resolution = text(body.resolution).trim();
    if (!resolution) throw invalid("resolution: must not be blank");
    resolveEscalationOf(db, r, e, user, resolution);
    out = toEscalation(e);
  } else if ((m = /^\/reviews\/([^/]+)\/(approve|request-changes)$/.exec(route)) && method === "POST") {
    if (user.role !== "reviewer") throw forbidden("Only reviewers can approve or request changes.");
    const r = reviewFor(db, user, decodeURIComponent(m[1]));
    if (r.status !== "in_review") throw invalid(`Only reviews that are in_review can be decided (this one is ${r.status}).`);
    if (r.assigneeId && r.assigneeId !== user.id) throw forbidden(`This review is assigned to ${userById(r.assigneeId)?.name ?? "another reviewer"}.`);
    if (openEscalation(db, r.id)) throw invalid("Resolve the open escalation before deciding.");
    const approving = m[2] === "approve";
    const note = text(body.note).trim();
    if (approving && unresolved(db, r.id)) throw invalid("Every finding must be edited or disputed before approval.");
    if (!approving && !note) throw invalid("A note is required when requesting changes.");
    conclude(db, r, user, approving ? "approved" : "changes_requested", note);
    out = { id: r.id, status: r.status };
  } else if ((m = /^\/reviews\/([^/]+)\/ai-disclosure$/.exec(route))) {
    const r = reviewFor(db, user, decodeURIComponent(m[1]));
    out = { review_id: r.id, steps: [
      { step: "rules", used_ai: false },
      { step: "retrieve", used_ai: false, data_sent: "none (embeddings computed on our own server)" },
      { step: "judge", used_ai: false, data_sent: "none (rules-only mode: LLM unavailable)" },
    ] } satisfies AiDisclosure;
  } else if (route === "/insights/summary") {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const rows = db.reviews.filter(r => canView(user, r));
    const counts = new Map<FindingType, number>();
    for (const f of db.findings) if (rows.some(r => r.id === f.reviewId)) counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
    out = {
      reviewed_this_month: rows.filter(r => +new Date(r.createdAt) >= monthStart).length,
      needs_attention: rows.filter(r => ["scanned", "resolving", "changes_requested"].includes(r.status)).length,
      awaiting_approval: rows.filter(r => r.status === "in_review").length,
      approved_this_month: rows.filter(r => r.status === "approved" && r.decidedAt && +new Date(r.decidedAt) >= monthStart).length,
      top_issues: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([type, count]) => ({ type, count })),
    } satisfies InsightsSummary;
  } else if (route === "/insights/gaps") {
    if (user.role !== "brand_admin") throw forbidden("Only brand admins can view guideline-gap insights.");
    const counts = new Map<string, number>();
    for (const f of db.findings) if (f.source && latest(f)?.action === "disputed") counts.set(f.source.id, (counts.get(f.source.id) ?? 0) + 1);
    out = [...counts].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({
      source_id: id, title: db.sources.find(s => s.id === id)?.title ?? id, dispute_count: n,
      note: n >= 5 ? "Often disputed; may be unclear." : `Disputed ${n} time(s); consider clarifying the wording.`,
    } satisfies InsightGap));
  } else {
    throw notFound(`No mock for ${method} ${route}`);
  }
  save();
  return out as T;
}
