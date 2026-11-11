import type {
  ActivityEvent, AiDisclosure, BrandSource, CommentResponse, FindingAction, Person, ReviewApiStatus, UserRole, VersionResponse,
} from "@/types/contract";
import { api } from "@/lib/api";
import { getSessionUser } from "@/lib/session";

/**
 * A complete, read-only record of how one review was handled: the decision, every finding and what was done about it,
 * what changed in the draft, who was involved, and what AI was used. Assembled from the same endpoints the review
 * screen uses, so it needs no extra backend call. The JSON download is exactly this object.
 */
export interface ReportFinding {
  id: string;
  type: string;
  severity: "high" | "medium" | "low";
  quote: string;
  source: { id: string; kind: string; version: string; title: string } | null;
  reason: string;
  method: "rule_based" | "ai_assisted";
  confidence: number;
  suggestion: string | null;
  decision: { action: FindingAction; reason: string; by: string | null; at: string | null } | null;
}

export type OutcomeKind = "approved" | "changes_requested" | "escalated" | "awaiting_decision" | "in_progress";

export interface DecisionReport {
  schema_version: 1;
  generated_at: string;
  generated_by: { name: string; role: UserRole } | null;
  review: { id: string; title: string; status: ReviewApiStatus; creator: string; assignee: Person | null; brand_kit_version: string; created_at: string; updated_at: string };
  outcome: { kind: OutcomeKind; headline: string; by: string | null; role: UserRole | null; at: string | null; note: string };
  summary: { findings: number; edited: number; disputed: number; accepted: number; open: number };
  findings: ReportFinding[];
  draft: { submitted: string; final: string; versions: number };
  versions: VersionResponse[];
  routing: ActivityEvent[];
  comments: CommentResponse[];
  activity: ActivityEvent[];
  ai_disclosure: AiDisclosure;
}

const ROUTING = new Set(["review_assigned", "review_escalated", "escalation_resolved"]);
const lastOf = (events: ActivityEvent[], type: ActivityEvent["type"]) => [...events].reverse().find(e => e.type === type);

function outcomeOf(status: ReviewApiStatus, events: ActivityEvent[], open: number, escalatedTo: string | null): DecisionReport["outcome"] {
  const decided = (e: ActivityEvent | undefined, headline: string, kind: OutcomeKind): DecisionReport["outcome"] =>
    ({ kind, headline, by: e?.actor?.name ?? null, role: e?.actor?.role ?? null, at: e?.at ?? null, note: e?.reason ?? "" });
  if (status === "approved") return decided(lastOf(events, "approved"), "Approved for publication", "approved");
  if (status === "changes_requested") return decided(lastOf(events, "changes_requested"), "Changes requested", "changes_requested");
  if (status === "in_review" && escalatedTo) return { kind: "escalated", headline: `Escalated to a ${escalatedTo}: decisions are paused`, by: null, role: null, at: null, note: "" };
  if (status === "in_review") return { kind: "awaiting_decision", headline: "Awaiting a reviewer's decision", by: null, role: null, at: null, note: "" };
  return { kind: "in_progress", headline: `${open} finding${open === 1 ? "" : "s"} still need a decision from the creator`, by: null, role: null, at: null, note: "" };
}

export async function buildReport(reviewId: string): Promise<DecisionReport> {
  const [review, findings, activity, comments, versions, disclosure, sources] = await Promise.all([
    api.getReview(reviewId), api.getFindings(reviewId), api.getActivity(reviewId), api.getComments(reviewId),
    api.getVersions(reviewId), api.getAiDisclosure(reviewId), api.getBrandSources().catch(() => [] as BrandSource[]),
  ]);
  const titles = new Map(sources.map(s => [s.id, s.title]));
  const decidedBy = new Map<string, ActivityEvent>();
  for (const e of activity) if (e.type === "finding_decision" && e.detail.finding_id) decidedBy.set(e.detail.finding_id, e);

  const rows: ReportFinding[] = findings.map(f => {
    const ev = decidedBy.get(f.finding_id);
    return {
      id: f.finding_id, type: f.type, severity: f.severity, quote: f.span.text, reason: f.reason, method: f.method, confidence: f.confidence,
      source: f.source ? { id: f.source.id, kind: f.source.kind, version: f.source.version, title: titles.get(f.source.id) ?? f.source.id } : null,
      suggestion: f.suggestion?.text ?? null,
      decision: f.decision ? { action: f.decision.action, reason: f.decision.reason, by: ev?.actor?.name ?? null, at: ev?.at ?? null } : null,
    };
  });
  const count = (a: FindingAction) => rows.filter(r => r.decision?.action === a).length;
  const open = rows.filter(r => !r.decision || r.decision.action === "accepted").length;
  const user = getSessionUser();

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    generated_by: user ? { name: user.name, role: user.role } : null,
    review: { id: review.id, title: review.title, status: review.status, creator: review.creator, assignee: review.assignee, brand_kit_version: review.brand_kit_version, created_at: review.created_at, updated_at: review.updated_at },
    outcome: outcomeOf(review.status, activity, open, review.open_escalation ? (review.open_escalation.to_role === "brand_admin" ? "brand admin" : "manager") : null),
    summary: { findings: rows.length, edited: count("edited"), disputed: count("disputed"), accepted: count("accepted"), open: rows.filter(r => !r.decision).length },
    findings: rows,
    draft: { submitted: versions[0]?.content ?? "", final: review.content, versions: versions.length },
    versions,
    routing: activity.filter(e => ROUTING.has(e.type)),
    comments,
    activity,
    ai_disclosure: disclosure,
  };
}
