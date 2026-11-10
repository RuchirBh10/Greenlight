"use client";
import { useState } from "react";
import { AlertTriangle, ArrowUpRight, UserCheck } from "lucide-react";
import { Avatar, Button, Card, CardHeader, Select, Textarea, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { can, useSession } from "@/lib/session";
import { useAsync } from "@/lib/use-api";
import { assignReview, escalateReview, resolveEscalation } from "../lib/store";
import type { Review } from "../types";

const ROLE_NOUN = { manager: "manager", brand_admin: "brand admin" } as const;
const fail = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

/** Who is responsible for this review, and what is holding up a decision. Hidden when there is nothing to show or do. */
export function ReviewRouting({ review }: { review: Review }) {
  const user = useSession();
  const { toast } = useToast();
  const e = review.openEscalation;
  const mayAssign = can.assign(user?.role) && review.status !== "Approved";
  const mayEscalate = user?.role === "reviewer" && review.status === "In review" && !e && (!review.assignee || review.assignee.id === user.id);
  const mayResolve = !!e && user?.role === e.to_role;
  const reviewers = useAsync(() => api.getReviewers(), mayAssign);
  const [pick, setPick] = useState<string | null>(null);
  const [toRole, setToRole] = useState<"brand_admin" | "manager">("brand_admin");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  if (!review.assignee && !e && !mayAssign && !mayEscalate) return null;

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try { await action(); toast(done, "success"); setText(""); } catch (err) { toast(fail(err), "warning"); } finally { setBusy(false); }
  }
  const selected = pick ?? review.assignee?.id ?? "";

  return (
    <Card>
      <CardHeader icon={UserCheck} title="Ownership" description="Who is responsible, and what is holding up the decision" />
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          {review.assignee
            ? <span className="flex items-center gap-2 text-sm text-ink"><Avatar name={review.assignee.name} size={28} /> Assigned to <strong>{review.assignee.name}</strong></span>
            : <span className="text-sm text-muted">No reviewer assigned. Any reviewer can decide.</span>}
        </div>

        {mayAssign && (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selected} onChange={ev => setPick(ev.target.value)} aria-label="Assign a reviewer" className="h-10 max-w-[240px] flex-1 text-sm">
              <option value="">Unassigned</option>
              {(reviewers.data ?? []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
            <Button size="sm" variant="secondary" loading={busy} disabled={selected === (review.assignee?.id ?? "")}
              onClick={() => run(() => assignReview(review.id, selected || null), selected ? "Reviewer assigned." : "Assignment removed.")}>Save</Button>
          </div>
        )}

        {e && (
          <div className="rounded-xl border border-warning/30 bg-warning/10 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-warning"><AlertTriangle size={15} /> Escalated to a {ROLE_NOUN[e.to_role]}</div>
            <p className="mt-1.5 text-sm leading-6 text-ink/85">{e.reason}</p>
            <p className="mt-1 text-xs text-muted">Raised by {e.raised_by.name} · {relativeTime(e.created_at)}. Nobody can approve or request changes until this is resolved.</p>
            {mayResolve && (
              <div className="mt-3 space-y-2">
                <Textarea rows={2} value={text} onChange={ev => setText(ev.target.value)} aria-label="Your ruling" placeholder="Your ruling (the reviewer will see this)…" />
                <Button size="sm" loading={busy} disabled={!text.trim()} onClick={() => run(() => resolveEscalation(review.id, e.id, text.trim()), "Escalation resolved. The reviewer can decide now.")}>Resolve escalation</Button>
              </div>
            )}
            {!mayResolve && <p className="mt-2 text-xs font-semibold text-muted">Waiting for a {ROLE_NOUN[e.to_role]} to resolve it.</p>}
          </div>
        )}

        {mayEscalate && (
          <details className="group rounded-xl border border-line">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-ink">
              Not sure? Escalate a question <ArrowUpRight size={14} className="text-muted" />
            </summary>
            <div className="space-y-2 border-t border-line p-4">
              <Select value={toRole} onChange={ev => setToRole(ev.target.value as typeof toRole)} aria-label="Escalate to" className="h-10 text-sm">
                <option value="brand_admin">Brand admin: a question about the rules or facts</option>
                <option value="manager">Manager: a question about priority or policy</option>
              </Select>
              <Textarea rows={2} value={text} onChange={ev => setText(ev.target.value)} aria-label="What do you need ruled on?" placeholder="What do you need ruled on?" />
              <Button size="sm" loading={busy} disabled={!text.trim()} onClick={() => run(() => escalateReview(review.id, toRole, text.trim()), "Escalated. Decisions are paused until it is resolved.")}>Escalate</Button>
            </div>
          </details>
        )}
      </div>
    </Card>
  );
}
