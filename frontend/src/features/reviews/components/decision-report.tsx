"use client";
import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Printer, SearchX } from "lucide-react";
import { Badge, Button, Card, EmptyState, Skeleton, buttonClass } from "@/components/ui";
import { LogoMark, Wordmark } from "@/components/layout/logo";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/session";
import { useAsync } from "@/lib/use-api";
import type { ActivityEvent } from "@/types/contract";
import { categoryLabel, kindLabel } from "../lib/adapters";
import { diffWords } from "../lib/diff";
import { buildReport, type DecisionReport, type OutcomeKind } from "../lib/report";
import { actorLabel } from "./audit-timeline";

const TONE: Record<OutcomeKind, string> = {
  approved: "border-success/30 bg-success/10",
  changes_requested: "border-danger/30 bg-danger/10",
  escalated: "border-warning/30 bg-warning/10",
  awaiting_decision: "border-info/30 bg-info/10",
  in_progress: "border-line bg-soft",
};
const SEVERITY = { high: "text-danger", medium: "text-warning", low: "text-info" } as const;
const ACTION = { accepted: "Confirmed as a valid issue", edited: "Edited", disputed: "Marked not applicable" } as const;

function download(report: DecisionReport) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: `greenlight-decision-report-${report.review.id}.json` }).click();
  URL.revokeObjectURL(url);
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mt-9">
    <h2 className="border-b border-line pb-2 text-sm font-bold uppercase tracking-wider text-muted">{title}</h2>
    <div className="mt-4">{children}</div>
  </section>
);
const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><dt className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</dt><dd className="mt-1 text-sm text-ink">{children}</dd></div>
);
const Who = ({ e }: { e: ActivityEvent }) => <>{actorLabel(e)}</>;

/** A complete, printable record of how one review was handled. Print it, save it as a PDF, or download the data. */
export function DecisionReportView({ id }: { id: string }) {
  const { data: r, loading, error } = useAsync(() => buildReport(id), true, id);
  const parts = useMemo(() => (r && r.versions.length > 1 ? diffWords(r.draft.submitted, r.draft.final) : null), [r]);

  if (loading && !r) return <div className="mx-auto max-w-[860px] space-y-5"><Skeleton className="h-10 w-64" /><Skeleton className="h-40" /><Skeleton className="h-96" /></div>;
  if (!r) {
    return (
      <Card><EmptyState icon={SearchX} title="Report not available" description={error ?? "It may not exist, or you may not have access to it."}
        action={<Link href="/reviews" className={buttonClass("primary", "md")}>Back to reviews</Link>} /></Card>
    );
  }

  return (
    <div className="mx-auto max-w-[860px]">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3" data-no-print>
        <Link href={`/reviews/${r.review.id}`} className="inline-flex items-center gap-2 text-xs font-semibold text-muted transition hover:text-brand"><ArrowLeft size={14} /> Back to the review</Link>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => download(r)}><Download size={15} /> Download data (JSON)</Button>
          <Button onClick={() => window.print()}><Printer size={15} /> Print or save as PDF</Button>
        </div>
      </div>

      <article className="rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-10 print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-[.16em] text-brand">Decision report</div>
            <h1 className="mt-2 text-[28px] font-bold leading-tight text-ink">{r.review.title}</h1>
            <p className="mt-2 text-xs text-muted">{r.review.id} · Brand Kit {r.review.brand_kit_version} · Generated {formatDateTime(r.generated_at)}{r.generated_by ? ` by ${r.generated_by.name} (${ROLE_LABEL[r.generated_by.role]})` : ""}</p>
          </div>
          <div className="hidden shrink-0 items-center gap-2 sm:flex"><LogoMark size={30} /><Wordmark /></div>
        </div>

        <div className={cn("mt-7 rounded-xl border p-5", TONE[r.outcome.kind])}>
          <div className="text-xs font-bold uppercase tracking-wider text-muted">Outcome</div>
          <div className="mt-1 text-xl font-bold text-ink">{r.outcome.headline}</div>
          {r.outcome.by && <p className="mt-1.5 text-sm text-ink/80">By {r.outcome.by}{r.outcome.role ? ` (${ROLE_LABEL[r.outcome.role]})` : ""}{r.outcome.at ? ` · ${formatDateTime(r.outcome.at)}` : ""}</p>}
          {r.outcome.note && <p className="mt-2 rounded-lg bg-surface/70 px-3 py-2 text-sm leading-6 text-ink/85">“{r.outcome.note}”</p>}
        </div>

        <dl className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-3">
          <Fact label="Created by">{r.review.creator}</Fact>
          <Fact label="Submitted">{formatDateTime(r.review.created_at)}</Fact>
          <Fact label="Last updated">{formatDateTime(r.review.updated_at)}</Fact>
          <Fact label="Reviewer assigned">{r.review.assignee?.name ?? "No one assigned"}</Fact>
          <Fact label="Findings">{r.summary.findings === 0 ? "None" : `${r.summary.findings}: ${r.summary.edited} edited, ${r.summary.disputed} not applicable${r.summary.accepted ? `, ${r.summary.accepted} confirmed only` : ""}${r.summary.open ? `, ${r.summary.open} undecided` : ""}`}</Fact>
          <Fact label="Draft versions">{r.draft.versions}</Fact>
        </dl>

        <Section title="Findings and decisions">
          {!r.findings.length && <p className="text-sm text-muted">The automated check found nothing to flag.</p>}
          <ol className="space-y-4">
            {r.findings.map((f, i) => (
              <li key={f.id} className="break-inside-avoid rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="font-bold text-muted">{i + 1}.</span>
                  <span className={cn("font-bold uppercase", SEVERITY[f.severity])}>{f.severity}</span>
                  <span className="font-semibold text-ink">{categoryLabel[f.type as keyof typeof categoryLabel] ?? f.type}</span>
                  <span className="text-muted">{f.method === "ai_assisted" ? "AI-assisted" : "Rule-based"} · {Math.round(f.confidence <= 1 ? f.confidence * 100 : f.confidence)}% confidence</span>
                </div>
                <p className="mt-2 text-[15px] leading-6 text-ink"><mark className="rounded bg-warning/20 px-1 text-ink">{f.quote}</mark></p>
                <p className="mt-2 text-sm leading-6 text-ink/80">{f.reason}</p>
                <p className="mt-1.5 text-xs leading-5 text-muted">
                  {f.source ? <>Source: {kindLabel[f.source.kind as keyof typeof kindLabel] ?? f.source.kind} {f.source.id} · {f.source.version} — {f.source.title}</> : "No approved source attached."}
                </p>
                <div className="mt-3 rounded-lg bg-soft px-3 py-2 text-sm">
                  {f.decision
                    ? <><span className="font-semibold text-ink">{ACTION[f.decision.action]}</span>{f.decision.by ? ` by ${f.decision.by}` : ""}{f.decision.at ? ` · ${formatDateTime(f.decision.at)}` : ""}{f.decision.reason && <span className="text-ink/80"> — {f.decision.reason}</span>}</>
                    : <span className="font-semibold text-warning">No decision recorded</span>}
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="What changed in the draft">
          {r.versions.length < 2 ? <p className="text-sm text-muted">No edits were made after submission.</p> : (
            <>
              <p className="mb-3 text-xs text-muted">Version 1 (as submitted) compared with version {r.draft.versions} (current). <ins className="rounded bg-success/15 px-1 no-underline">Added</ins> and <del className="rounded bg-danger/15 px-1">removed</del> wording is marked.</p>
              <div className="whitespace-pre-wrap rounded-xl border border-line bg-soft/60 p-4 text-[15px] leading-7 text-ink">
                {parts === null ? r.draft.final : parts.map((p, i) => p.type === "same" ? <span key={i}>{p.text}</span>
                  : p.type === "add" ? <ins key={i} className="rounded bg-success/15 px-0.5 no-underline">{p.text}</ins> : <del key={i} className="rounded bg-danger/15 px-0.5 text-ink/70">{p.text}</del>)}
              </div>
            </>
          )}
          <h3 className="mt-5 text-xs font-bold uppercase tracking-wider text-muted">Final text</h3>
          <div className="mt-2 whitespace-pre-wrap rounded-xl border border-line p-4 text-[15px] leading-7 text-ink">{r.draft.final}</div>
        </Section>

        <Section title="Assignment and escalation">
          {!r.routing.length ? <p className="text-sm text-muted">This review was not assigned or escalated.</p> : (
            <ul className="space-y-3">{r.routing.map(e => (
              <li key={e.id} className="break-inside-avoid text-sm"><span className="font-semibold text-ink">{e.summary}</span><span className="text-muted"> · <Who e={e} /> · {formatDateTime(e.at)}</span>{e.reason && <p className="mt-0.5 text-ink/80">{e.reason}</p>}</li>
            ))}</ul>
          )}
        </Section>

        <Section title="Discussion">
          {!r.comments.length ? <p className="text-sm text-muted">No comments.</p> : (
            <ul className="space-y-3">{r.comments.map(c => (
              <li key={c.id} className="break-inside-avoid text-sm"><span className="font-semibold text-ink">{c.author}</span> <Badge>{ROLE_LABEL[c.role]}</Badge><span className="text-muted"> · {formatDateTime(c.created_at)}</span><p className="mt-0.5 whitespace-pre-wrap leading-6 text-ink/85">{c.text}</p></li>
            ))}</ul>
          )}
        </Section>

        <Section title="Audit trail">
          <table className="w-full border-collapse text-left text-xs">
            <thead><tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted"><th className="py-2 pr-3 font-bold">When</th><th className="py-2 pr-3 font-bold">Who</th><th className="py-2 font-bold">What</th></tr></thead>
            <tbody>
              {r.activity.map(e => (
                <tr key={e.id} className="break-inside-avoid border-b border-line align-top">
                  <td className="whitespace-nowrap py-2 pr-3 text-muted">{formatDateTime(e.at)}</td>
                  <td className="py-2 pr-3 text-ink/85"><Who e={e} /></td>
                  <td className="py-2 text-ink">{e.summary}{e.reason && <span className="block text-muted">Reason: {e.reason}</span>}{e.type === "comment_added" && e.detail.text && <span className="block text-muted">“{e.detail.text}”</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="AI use for this review">
          <ul className="space-y-2 text-sm">
            {r.ai_disclosure.steps.map((s, i) => (
              <li key={`${s.step}-${i}`} className="break-inside-avoid"><span className="font-semibold text-ink">{{ rules: "Rule checks", retrieve: "Source retrieval", judge: "AI judgement" }[s.step] ?? s.step}</span>
                <span className="text-muted"> · {s.used_ai ? `AI used${s.model ? ` (${s.model})` : ""}` : "No AI used"}{s.data_sent ? ` · ${s.data_sent}` : ""}</span></li>
            ))}
          </ul>
        </Section>

        <div className="mt-10 border-t border-line pt-4 text-[11px] leading-5 text-muted">
          Greenlight surfaces possible conflicts with approved brand rules and facts. Every decision recorded above was made by a person. This report is a read-only record; the full history stays on the server.
        </div>
      </article>
    </div>
  );
}
