"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CheckCheck, CheckCircle2, Clock3, ShieldCheck, UserX } from "lucide-react";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, PageHeader, ScoreRing, Select, Skeleton, StatCard, StatusBadge, useToast } from "@/components/ui";
import { brandSafetyScore, isPending, openCount } from "@/features/reviews/lib/metrics";
import { escalatedTo, needsRouting, reviewerCanDecide } from "@/features/reviews/lib/queue";
import { approveReview, assignReview, useReviews, useReviewsLoaded } from "@/features/reviews/lib/store";
import type { Review } from "@/features/reviews/types";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { pad, relativeTime } from "@/lib/format";
import { can, useSession } from "@/lib/session";
import { useAsync } from "@/lib/use-api";
import type { UserRole } from "@/types/contract";

type Filter = "all" | "mine" | "unassigned" | "escalated";
const cols = "md:grid-cols-[1.6fr_1.1fr_1fr_70px_150px]";
const COPY: Record<UserRole, { eyebrow: string; title: string; text: string; first: Filter; firstLabel: string }> = {
  reviewer: { eyebrow: "Team workflow · Decisions", title: "Approval queue", text: "Review completed checks and make the final human decision.", first: "mine", firstLabel: "Mine to decide" },
  manager: { eyebrow: "Team workflow · Routing", title: "Queue and routing", text: "See what is waiting, assign a reviewer, and keep escalations moving.", first: "unassigned", firstLabel: "Needs a reviewer" },
  brand_admin: { eyebrow: "Team workflow · Rulings", title: "Escalations", text: "Questions reviewers could not settle alone. Resolve them so decisions can continue.", first: "escalated", firstLabel: "Escalated to me" },
  creator: { eyebrow: "Team workflow", title: "Queue", text: "", first: "all", firstLabel: "All" },
};

export function ApprovalsView() {
  const user = useSession();
  const role = user?.role ?? "reviewer";
  const copy = COPY[role];
  const reviews = useReviews();
  const loaded = useReviewsLoaded();
  const { toast } = useToast();
  const reviewers = useAsync(() => api.getReviewers(), can.assign(role));
  const [picked, setPicked] = useState<Filter | null>(null);
  const [busy, setBusy] = useState("");

  const pending = useMemo(() => reviews.filter(isPending), [reviews]);
  const inReview = pending.filter(r => r.status === "In review");
  const escalated = pending.filter(r => r.openEscalation);
  const unassigned = pending.filter(needsRouting);
  const mine = pending.filter(r => (role === "reviewer" ? reviewerCanDecide(r, user?.id ?? "") : escalatedTo(r, role)));
  const filter: Filter = picked ?? (mine.length || role === "reviewer" ? "mine" : escalated.length ? "escalated" : "all");
  const lists: Record<Filter, Review[]> = {
    all: pending, escalated, unassigned,
    mine: role === "reviewer" ? mine : role === "brand_admin" ? mine : unassigned,
  };
  const rows = lists[filter];
  const chips: Array<[Filter, string, number]> = [
    ["mine", role === "manager" ? "Needs a reviewer" : copy.firstLabel, role === "manager" ? unassigned.length : mine.length],
    ["escalated", "Escalated", escalated.length],
    ...(role === "manager" ? [] : [["unassigned", "Unassigned", unassigned.length] as [Filter, string, number]]),
    ["all", "All open", pending.length],
  ];
  const approved = reviews.filter(r => r.status === "Approved").length;

  async function approve(r: Review) {
    setBusy(r.id);
    try { await approveReview(r.id); toast(`“${r.title}” approved.`); } catch (e) { toast(e instanceof Error ? e.message : "Could not approve.", "warning"); } finally { setBusy(""); }
  }
  async function assign(r: Review, reviewerId: string) {
    setBusy(r.id);
    try { await assignReview(r.id, reviewerId || null); toast(reviewerId ? "Reviewer assigned." : "Assignment removed."); } catch (e) { toast(e instanceof Error ? e.message : "Could not assign.", "warning"); } finally { setBusy(""); }
  }

  return (
    <div>
      <PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.text} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Clock3} tone="warning" label="Awaiting decision" value={loaded ? pad(inReview.length) : "—"} hint="In review right now" />
        <StatCard icon={AlertTriangle} tone="danger" label="Escalated" value={loaded ? pad(escalated.length) : "—"} hint="Decisions paused" />
        <StatCard icon={UserX} label="No reviewer yet" value={loaded ? pad(unassigned.length) : "—"} hint="Ready but unassigned" />
        <StatCard icon={CheckCircle2} tone="success" label="Approved" value={loaded ? pad(approved) : "—"} hint="In this workspace" />
      </div>

      <Card className="overflow-hidden">
        <CardHeader icon={ShieldCheck} title="Queue" description="Ownership and blockers at a glance" />
        <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3" role="tablist" aria-label="Queue filter">
          {chips.map(([id, label, n]) => (
            <button key={id} role="tab" aria-selected={filter === id} onClick={() => setPicked(id)}
              className={cn("rounded-full border px-3.5 py-1.5 text-xs font-semibold transition", filter === id ? "border-brand bg-brand/10 text-brand" : "border-line text-muted hover:text-ink")}>
              {label} <span className="ml-1 opacity-70">{n}</span>
            </button>
          ))}
        </div>
        <div className={`hidden gap-3 bg-soft px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-muted md:grid ${cols}`}><span>Submission</span><span>Owner</span><span>Status</span><span>Safety</span><span className="text-right">Action</span></div>
        {!loaded && <div className="space-y-3 p-5"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>}
        {loaded && !rows.length && <EmptyState icon={CheckCircle2} title="Nothing here" description="Switch the filter above to see everything that is open." />}
        {rows.map(r => {
          const canApproveNow = role === "reviewer" && reviewerCanDecide(r, user?.id ?? "") && openCount(r) === 0 && r.findings.every(f => f.status !== "Accepted");
          return (
            <div key={r.id} className={`grid gap-3 border-t border-line px-5 py-4 md:items-center ${cols}`}>
              <Link href={`/reviews/${r.id}`} className="group min-w-0">
                <div className="truncate text-sm font-semibold text-ink group-hover:text-brand">{r.title}</div>
                <div className="mt-0.5 text-xs text-muted">{r.id} · by {r.creator} · {openCount(r)} open · {relativeTime(r.updatedAt)}</div>
              </Link>
              <div className="min-w-0 space-y-1.5">
                {r.assignee
                  ? <div className="flex items-center gap-2 text-sm text-ink/85"><Avatar name={r.assignee.name} size={24} /><span className="truncate">{r.assignee.name}</span></div>
                  : <span className="text-xs text-muted">Unassigned</span>}
                {r.openEscalation && <Badge tone="warning" dot>Escalated to {r.openEscalation.to_role === "brand_admin" ? "brand admin" : "manager"}</Badge>}
              </div>
              <div><StatusBadge>{r.status}</StatusBadge></div>
              <ScoreRing value={brandSafetyScore(r.findings)} size={40} stroke={5} label="Safety" />
              <div className="flex items-center gap-2 md:justify-end">
                {can.assign(role) && r.status !== "Approved" && (
                  <Select aria-label={`Assign a reviewer to ${r.title}`} value={r.assignee?.id ?? ""} disabled={busy === r.id} onChange={e => assign(r, e.target.value)} className="h-9 w-[140px] text-xs">
                    <option value="">Unassigned</option>
                    {(reviewers.data ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                )}
                {canApproveNow
                  ? <Button size="sm" loading={busy === r.id} onClick={() => approve(r)}><CheckCheck size={13} /> Approve</Button>
                  : !can.assign(role) && <Link href={`/reviews/${r.id}`} className="inline-flex items-center gap-1 text-xs font-bold text-brand hover:text-brand-strong">{escalatedTo(r, role) ? "Resolve" : "Open"} <ArrowUpRight size={13} /></Link>}
              </div>
            </div>
          );
        })}
      </Card>
      <p className="mt-3 text-center text-xs text-muted">Human approval is the final step. Automated checks cannot approve or reject content.</p>
    </div>
  );
}
