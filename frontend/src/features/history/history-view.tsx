"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Download, FileClock, Gavel, Printer, Search } from "lucide-react";
import { Button, Card, EmptyState, PageHeader, Select, Skeleton, StatCard } from "@/components/ui";
import { EventBody, actorLabel, auditMeta } from "@/features/reviews/components/audit-timeline";
import { kindOf } from "@/features/reviews/lib/activity";
import type { AuditKind } from "@/features/reviews/types";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime, pad } from "@/lib/format";
import { useAsync } from "@/lib/use-api";

/** Neutralise spreadsheet formula injection, then quote. */
const cell = (v: string) => `"${(/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;

/** Every recorded action across the reviews you can see, newest first. This is the server's own audit trail. */
export function HistoryView() {
  const feed = useAsync(() => api.getRecentActivity(200));
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<AuditKind | "all">("all");

  const all = useMemo(() => feed.data ?? [], [feed.data]);
  const rows = all.filter(e => (kind === "all" || kindOf(e.type) === kind)
    && `${e.summary} ${e.reason} ${e.actor?.name ?? "Greenlight"} ${e.review_title ?? ""} ${e.review_id ?? ""} ${e.detail.text ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const loaded = !feed.loading || feed.data !== undefined;

  function exportCsv() {
    const lines = [["Time", "Review ID", "Review", "Actor", "Role", "Type", "Event", "Reason"],
      ...rows.map(e => [e.at, e.review_id ?? "", e.review_title ?? "", e.actor?.name ?? "Greenlight (automated)", e.actor?.role ?? "system", e.type, e.summary, e.reason])];
    const url = URL.createObjectURL(new Blob([lines.map(l => l.map(cell).join(",")).join("\n")], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "greenlight-audit-trail.csv" });
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader eyebrow="Governance records · Audit trail" title="Audit history" description="Who did what, when and why, across every review you can see. Recorded by the server, never editable."
        actions={<><Button variant="secondary" onClick={() => window.print()}><Printer size={15} /> Print</Button><Button onClick={exportCsv} disabled={!rows.length}><Download size={15} /> Export CSV</Button></>} />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard icon={FileClock} label="Events recorded" value={loaded ? pad(all.length) : "—"} />
        <StatCard icon={Gavel} tone="warning" label="Decisions and edits" value={loaded ? pad(all.filter(e => e.type === "finding_decision" || e.type === "content_edited").length) : "—"} />
        <StatCard icon={CheckCircle2} tone="success" label="Approvals" value={loaded ? pad(all.filter(e => e.type === "approved").length) : "—"} />
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full max-w-sm">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search audit history…" aria-label="Search audit history"
              className="h-10 w-full rounded-xl border border-line bg-soft pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-muted focus:border-brand focus:bg-surface focus:ring-4 focus:ring-brand/15" />
          </div>
          <Select value={kind} onChange={e => setKind(e.target.value as AuditKind | "all")} className="h-10 sm:w-44" aria-label="Filter by event type">
            <option value="all">All events</option>
            {(Object.keys(auditMeta) as AuditKind[]).map(k => <option key={k} value={k}>{auditMeta[k].label}</option>)}
          </Select>
        </div>
        {!loaded && <div className="p-5"><Skeleton className="h-40" /></div>}
        {feed.error && <p className="p-5 text-sm text-danger">{feed.error}</p>}
        {loaded && !feed.error && !rows.length && <EmptyState icon={Search} title="No matching events" />}
        <ol className="px-5 py-4">
          {rows.map((e, i) => {
            const { icon: Icon, tone } = auditMeta[kindOf(e.type)];
            return (
              <li key={e.id} className="relative flex gap-4 pb-6 last:pb-2">
                {i < rows.length - 1 && <span className="absolute left-[17px] top-9 h-[calc(100%-30px)] w-px bg-line" />}
                <span className={cn("z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", tone)}><Icon size={15} /></span>
                <div className="min-w-0 flex-1">
                  <EventBody e={e} />
                  <p className="mt-1 text-xs text-muted">{actorLabel(e)} · {formatDateTime(e.at)}{e.review_id && <> · <Link href={`/reviews/${e.review_id}`} className="font-semibold text-brand hover:underline">{e.review_id} · {e.review_title}</Link></>}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}
