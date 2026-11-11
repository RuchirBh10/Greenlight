import { EMAILS, loginAs, reviewInReview, type TestModule } from "./harness";

const mod: TestModule = {
  name: "Decision report",
  async run(t) {
    const { api } = await import("@/lib/api");
    const { buildReport } = await import("@/features/reviews/lib/report");

    // a review that is approved after being assigned and escalated once
    const id = await reviewInReview("Report test");
    await loginAs(EMAILS.manager);
    const priya = (await api.getReviewers()).find(m => m.name === "Priya Nair")!;
    await api.assignReview(id, { reviewer_id: priya.id, note: "You know this brand" });
    await loginAs(EMAILS.reviewer);
    const esc = await api.escalateReview(id, { to_role: "brand_admin", reason: "Is this claim covered?" });
    await loginAs(EMAILS.admin);
    await api.resolveEscalation(id, esc.id, { resolution: "Covered by F-12." });
    await loginAs(EMAILS.reviewer);

    let r = await buildReport(id);
    t.ok(r.outcome.kind === "in_progress" || r.outcome.kind === "awaiting_decision", `before the decision the outcome is open (${r.outcome.kind})`);
    await api.approveReview(id, { note: "Verified against the approved facts." });

    await loginAs(EMAILS.manager);
    r = await buildReport(id);
    t.ok(r.schema_version === 1 && !isNaN(+new Date(r.generated_at)) && r.generated_by?.role === "manager", "report carries a schema version, a timestamp and who generated it");
    t.ok(r.review.id === id && r.review.status === "approved" && r.review.creator === "Aarav Mehta" && r.review.assignee?.name === "Priya Nair", "review facts are correct");
    t.ok(r.outcome.kind === "approved" && r.outcome.by === "Priya Nair" && r.outcome.role === "reviewer" && r.outcome.note === "Verified against the approved facts.", "the outcome names who approved it and why");
    t.ok(!!r.outcome.at, "the outcome has a time");
    t.ok(r.findings.length >= 2 && r.summary.findings === r.findings.length, `findings are listed (${r.findings.length})`);
    t.ok(r.findings.every(f => f.decision && f.decision.by === "Aarav Mehta" && f.decision.at), "every finding shows who decided it and when");
    t.ok(r.summary.edited + r.summary.disputed + r.summary.accepted + r.summary.open === r.summary.findings && r.summary.open === 0, "decision counts add up");
    t.ok(r.findings.every(f => f.quote && f.reason && (f.source === null || f.source.title)), "each finding has its quote, reason and a source title");
    t.ok(r.draft.versions >= 2 && r.draft.submitted !== r.draft.final, "the draft shows what was submitted and what it became");
    t.ok(r.routing.map(e => e.type).join() === "review_assigned,review_escalated,escalation_resolved", "assignment and escalation are listed in order");
    t.ok(r.comments.some(c => c.text.startsWith("Escalation resolved:")), "the discussion is included");
    t.ok(r.activity.length > r.routing.length && r.activity[0].type === "review_submitted" && r.activity[r.activity.length - 1].type === "approved", "the full trail runs from submission to approval");
    t.ok(r.ai_disclosure.steps.length > 0, "the AI-use record is included");
    t.ok(JSON.stringify(JSON.parse(JSON.stringify(r))) === JSON.stringify(r), "the report survives a JSON round trip");

    // a review that was sent back
    const back = await reviewInReview("Report: sent back");
    await loginAs(EMAILS.reviewer);
    await api.requestChanges(back, { note: "Please re-check the delivery claim" });
    const b = await buildReport(back);
    t.ok(b.outcome.kind === "changes_requested" && b.outcome.by === "Priya Nair" && b.outcome.note === "Please re-check the delivery claim", "a sent-back review reports who asked for what");

    // an escalated one, and one still being worked on
    const held = await reviewInReview("Report: escalated");
    await loginAs(EMAILS.reviewer);
    await api.escalateReview(held, { to_role: "manager", reason: "Priority call needed" });
    t.ok((await buildReport(held)).outcome.kind === "escalated", "an escalated review reports decisions are paused");
    await loginAs(EMAILS.creator);
    const draft = await (await import("@/features/reviews/lib/store")).createReview({ title: "Report: unresolved", channel: "Email", mode: "Full brand review", brandKit: "x", content: "India's #1 fastest delivery, guaranteed." });
    const w = await buildReport(draft.id);
    t.ok(w.outcome.kind === "in_progress" && w.summary.open === w.summary.findings && w.summary.findings > 0, "an unresolved review reports how many findings are left");

    // access follows review visibility
    await loginAs(EMAILS.reviewer);
    await t.rejects(buildReport(draft.id), 404, "a reviewer cannot build a report for a review they cannot see");
  },
};
export default mod;
