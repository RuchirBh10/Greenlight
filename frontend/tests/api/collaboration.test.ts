import { EMAILS, loginAs, type TestModule } from "./harness";

const mod: TestModule = {
  name: "Collaboration: activity, comments, versions",
  async run(t) {
    const { api } = await import("@/lib/api");
    const { diffWords } = await import("@/features/reviews/lib/diff");
    const store = await import("@/features/reviews/lib/store");

    // the word diff
    const d = diffWords("Meet the Zippy bottle today.", "Meet the Zippy Bottle today.")!;
    t.ok(d.some(p => p.type === "del" && p.text === "bottle") && d.some(p => p.type === "add" && p.text === "Bottle"), "diff finds the changed word");
    t.ok(d.map(p => (p.type === "add" ? "" : p.text)).join("") === "Meet the Zippy bottle today.", "diff rebuilds the old text");
    t.ok(d.map(p => (p.type === "del" ? "" : p.text)).join("") === "Meet the Zippy Bottle today.", "diff rebuilds the new text");
    t.ok(diffWords("same", "same")!.every(p => p.type === "same"), "identical text has no changes");
    const big = "word ".repeat(3000);
    t.ok(diffWords(big, `${big}x`) !== null, "a one-word edit in a long draft stays cheap");

    // submit, comment, resolve
    await loginAs(EMAILS.creator);
    const created = await store.createReview({ title: "Collab test", channel: "Email", mode: "Full brand review", brandKit: "x",
      content: "Meet the Zippy bottle. India's #1 fastest delivery, guaranteed. Act now!!!" });
    const id = created.id;
    let ev = await api.getActivity(id);
    t.ok(ev[0].type === "review_submitted" && ev[0].actor?.name === "Aarav Mehta" && ev[0].actor.role === "creator", "first event: submitted by the creator");
    const scan = ev.find(e => e.type === "scan_completed");
    t.ok(!!scan && scan.actor === null && /Automated check/.test(scan.summary), "the automated check is attributed to the system");
    t.ok((await api.getVersions(id)).length === 1, "one version after submission");
    t.ok(!isNaN(+new Date((await api.getReview(id)).created_at)), "review has a created_at");

    await t.rejects(api.addComment(id, { text: "   " }), 422, "blank comment rejected");
    t.ok((await api.addComment(id, { text: "Checking the delivery claim with legal." })).role === "creator", "creator can comment");
    const f0 = created.findings[0];
    t.ok((await api.addComment(id, { text: "About this one", finding_id: f0.id })).finding_id === f0.id, "a comment can point at a finding");
    await t.rejects(api.addComment(id, { text: "x", finding_id: "FD-nope" }), 422, "a finding from another review is rejected");

    const findings = await api.getFindings(id);
    for (const f of findings) {
      if (f.suggestion) await store.rewriteFinding(id, f.finding_id, f.suggestion.text, "suggestion");
      else await store.decideFinding(id, f.finding_id, "Disputed", "Reviewed and acceptable for this campaign");
    }
    const versions = await api.getVersions(id);
    t.ok(versions.length >= 2 && versions[0].reason === "submitted" && versions[1].created_by === "Aarav Mehta", `edits are saved as versions (${versions.length})`);
    t.ok(diffWords(versions[0].content, versions[versions.length - 1].content)!.some(p => p.type !== "same"), "the diff between first and latest shows the edits");
    ev = await api.getActivity(id);
    t.ok(ev.filter(e => e.type === "finding_decision").length === findings.length, "one decision event per finding");
    t.ok(ev.some(e => e.type === "content_edited" && e.reason), "edits are recorded with a reason");
    t.ok(ev.find(e => e.type === "comment_added")?.detail.text === "Checking the delivery claim with legal.", "comment text appears in the history");
    t.ok((await api.getReview(id)).status === "in_review", "all findings resolved -> in_review");

    // the reviewer
    await loginAs(EMAILS.reviewer);
    t.ok((await api.addComment(id, { text: "Looks nearly there." })).role === "reviewer", "a reviewer can comment on an in-review item");
    await t.rejects(api.requestChanges(id, { note: "" }), 422, "request changes needs a note");
    await api.requestChanges(id, { note: "Please re-check the delivery claim" });
    const thread = await api.getComments(id);
    t.ok(thread[thread.length - 1].text === "Please re-check the delivery claim" && thread[thread.length - 1].role === "reviewer", "the request-changes note lands in the discussion");
    ev = await api.getActivity(id);
    t.ok(ev[ev.length - 1].type === "changes_requested" && ev[ev.length - 1].reason === "Please re-check the delivery claim", "the decision is recorded with its reason");
    t.ok(!ev.some(e => e.type === "status_changed" && (e.detail as { to?: string }).to === "changes_requested"), "the decision is not listed twice");

    // visibility
    await loginAs(EMAILS.creator);
    const second = await store.createReview({ title: "Second", channel: "Email", mode: "Full brand review", brandKit: "x", content: "Best ever delivery, guaranteed." });
    await loginAs(EMAILS.reviewer);
    await t.rejects(api.getActivity(second.id), 404, "a reviewer cannot read the history of a review that is not in review");
    await t.rejects(api.getComments(second.id), 404, "…or its comments");
    await t.rejects(api.getVersions(second.id), 404, "…or its versions");
    const feed = await api.getRecentActivity(200);
    t.ok(feed.length > 0 && feed.every(e => e.review_id !== second.id), "the reviewer's feed excludes it");
    t.ok(feed.every(e => !!e.review_title), "the feed carries review titles");
    const ids = feed.map(e => Number(e.id.slice(2)));
    t.ok(ids.every((n, i) => i === 0 || n < ids[i - 1]), "the feed is newest first");
    await t.rejects(api.getRecentActivity(0), 422, "the feed limit is validated");
    await loginAs(EMAILS.manager);
    t.ok((await api.getRecentActivity(200)).some(e => e.review_id === second.id), "the manager's feed includes everything");
    t.ok((await api.addComment(second.id, { text: "Managers can comment." })).role === "manager", "a manager can comment");
    await loginAs(EMAILS.admin);
    t.ok((await api.addComment(second.id, { text: "Admins can too." })).role === "brand_admin", "a brand admin can comment");
  },
};
export default mod;
