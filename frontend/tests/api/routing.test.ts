import { EMAILS, loginAs, reviewInReview, type TestModule } from "./harness";

const mod: TestModule = {
  name: "Routing: assignment and escalation",
  async run(t) {
    const { api, getMode } = await import("@/lib/api");
    const q = await import("@/features/reviews/lib/queue");
    type R = Parameters<typeof q.reviewerCanDecide>[0];
    const r = (over: Partial<R>) => ({ status: "In review", findings: [], ...over }) as R;
    const person = { id: "U-9", name: "X" };
    const esc = (to: "manager" | "brand_admin") => ({ to_role: to }) as R["openEscalation"];

    // the queue helpers that drive the menu badge, the dashboard and the queue
    t.ok(q.reviewerCanDecide(r({}), "U-3") && !q.reviewerCanDecide(r({ openEscalation: esc("manager") }), "U-3"), "a reviewer can decide an unassigned review, not an escalated one");
    t.ok(!q.reviewerCanDecide(r({ assignee: person }), "U-3") && q.reviewerCanDecide(r({ assignee: { id: "U-3", name: "P" } }), "U-3"), "only the assignee can decide an assigned review");
    t.ok(q.approvalsBadge([r({}), r({}), r({ openEscalation: esc("brand_admin") })], "reviewer", "U-3") === 2, "the reviewer badge counts what they can decide");
    t.ok(q.approvalsBadge([r({}), r({ openEscalation: esc("manager") }), r({ openEscalation: esc("brand_admin") })], "manager", "U-2") === 2, "the manager badge counts unrouted plus escalated to managers");
    t.ok(q.approvalsBadge([r({ openEscalation: esc("brand_admin") })], "brand_admin", "U-4") === 1 && q.approvalsBadge([r({})], "creator", "U-1") === 0, "the brand admin and creator badges");

    const id = await reviewInReview("Routing test");
    t.ok((await api.getReview(id)).status === "in_review", "the review reached in_review");
    await t.rejects(api.getReviewers(), 403, "a creator cannot list reviewers");
    await t.rejects(api.assignReview(id, { reviewer_id: "U-3" }), 403, "a creator cannot assign");

    // a manager assigns
    await loginAs(EMAILS.manager);
    const team = await api.getReviewers();
    const priya = team.find(m => m.name === "Priya Nair")!;
    t.ok(!!priya, "the manager sees the reviewers");
    await t.rejects(api.assignReview(id, { reviewer_id: "U-1" }), 422, "a non-reviewer cannot be assigned");
    t.ok((await api.assignReview(id, { reviewer_id: priya.id, note: "You know this brand" })).assignee?.name === "Priya Nair", "the manager assigns a reviewer");
    const detail = await api.getReview(id);
    t.ok(detail.assignee?.id === priya.id && detail.open_escalation === null, "the detail shows the assignee");
    t.ok((await api.getReviews()).find(x => x.id === id)?.assignee?.name === "Priya Nair", "the list shows the assignee");
    const before = (await api.getActivity(id)).length;
    await api.assignReview(id, { reviewer_id: priya.id });
    t.ok((await api.getActivity(id)).length === before, "repeating the same assignment records nothing");

    // the reviewer escalates and decisions pause
    await loginAs(EMAILS.reviewer);
    await t.rejects(api.escalateReview(id, { to_role: "brand_admin", reason: "  " }), 422, "an escalation needs a reason");
    const e = await api.escalateReview(id, { to_role: "brand_admin", reason: "Is this claim covered by an approved fact?" });
    t.ok(e.status === "open" && e.to_role === "brand_admin" && e.raised_by.name === "Priya Nair", "the reviewer escalates to a brand admin");
    await t.rejects(api.escalateReview(id, { to_role: "manager", reason: "again" }), 422, "only one open escalation at a time");
    await t.rejects(api.approveReview(id, { note: "ok" }), 422, "approve is blocked while escalated");
    await t.rejects(api.requestChanges(id, { note: "no" }), 422, "request changes is blocked while escalated");
    t.ok((await api.getReview(id)).open_escalation?.id === e.id, "the detail carries the open escalation");

    // only the right role resolves it
    await loginAs(EMAILS.manager);
    await t.rejects(api.resolveEscalation(id, e.id, { resolution: "fine" }), 403, "a manager cannot resolve one sent to brand admins");
    await loginAs(EMAILS.admin);
    await t.rejects(api.resolveEscalation(id, e.id, { resolution: "  " }), 422, "the resolution must not be blank");
    const done = await api.resolveEscalation(id, e.id, { resolution: "Covered by F-12. Wording is fine." });
    t.ok(done.status === "resolved" && done.resolved_by?.name === "Ruchir Bharadwaj" && done.resolution.startsWith("Covered"), "the brand admin resolves it");
    await t.rejects(api.resolveEscalation(id, e.id, { resolution: "again" }), 422, "it cannot be resolved twice");

    await loginAs(EMAILS.reviewer);
    t.ok((await api.approveReview(id, { note: "ok" })).status === "approved", "the reviewer can approve once it is resolved");

    // history and discussion
    await loginAs(EMAILS.creator);
    const ev = await api.getActivity(id);
    t.ok(ev.some(x => x.type === "review_assigned" && x.summary === "Assigned to Priya Nair" && x.reason === "You know this brand"), "the assignment is in the audit trail with its note");
    t.ok(ev.some(x => x.type === "review_escalated" && x.summary === "Escalated to a brand admin" && x.actor?.role === "reviewer"), "the escalation is in the audit trail");
    t.ok(ev.some(x => x.type === "escalation_resolved" && x.actor?.role === "brand_admin" && x.reason.startsWith("Covered")), "the resolution is in the audit trail");
    const texts = (await api.getComments(id)).map(c => c.text);
    t.ok(texts.includes("Escalated to brand admin: Is this claim covered by an approved fact?") && texts.some(x => x.startsWith("Escalation resolved:")), "routing appears in the discussion");

    if (getMode() === "demo") {
      await loginAs(EMAILS.admin);
      t.ok((await api.getReviews()).find(x => x.title === "Sustainability announcement")?.open_escalation?.to_role === "brand_admin", "demo: a seeded escalation is waiting for the brand admin");
      await loginAs(EMAILS.manager);
      t.ok((await api.getReviews()).some(x => x.title === "Product feature email" && x.assignee?.name === "Priya Nair"), "demo: a seeded review is assigned to the reviewer");
    }
  },
};
export default mod;
