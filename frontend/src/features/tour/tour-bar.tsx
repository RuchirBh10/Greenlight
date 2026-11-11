"use client";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, Check, ChevronDown, Compass, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { ROLE_LABEL, switchDemoRole, useIsDemo, useSession } from "@/lib/session";
import { useReviews } from "@/features/reviews/lib/store";
import type { UserRole } from "@/types/contract";
import { setTourOpen, tourStore, type TourStep } from "./store";

type Step = { id: TourStep; role: UserRole; title: string; hint: string; here: string; base: string };
const STEPS: Step[] = [
  { id: "submit", role: "creator", base: "/reviews/new", title: "Submit a risky draft",
    hint: "Sample copy with an unsupported claim, pressure language and a naming slip is ready to go.", here: "The sample is loaded. Press Run review (top right)." },
  { id: "evidence", role: "creator", base: "/reviews/", title: "Inspect a finding's evidence",
    hint: "See the exact quote, the approved source behind it, and why it was flagged.", here: "Click a highlighted phrase in the draft, or any finding in the list." },
  { id: "resolve", role: "creator", base: "/reviews/", title: "Resolve every finding",
    hint: "Apply a suggested fix, write your own, or dispute it with a reason. Then it goes to a reviewer.", here: "Apply a suggestion or dispute it with a reason. Repeat until the progress bar is full." },
  { id: "audit", role: "creator", base: "/reviews/", title: "Open the audit trail",
    hint: "Every action on a review, with who did it, when and why. Then open the printable Decision report.", here: "Open the Activity tab on the right. Try Changes, and the Decision report button at the top." },
  { id: "approve", role: "reviewer", base: "/approvals", title: "Approve as a reviewer",
    hint: "Only a person can approve or send a draft back. The software never does.", here: "Press Approve on a review that is waiting for you." },
  { id: "escalation", role: "brand_admin", base: "/reviews/", title: "Resolve an escalation",
    hint: "A reviewer asked a question they could not answer alone. Nobody can decide until it is resolved.", here: "Press Resolve escalation, write your ruling, and send it." },
  { id: "kit", role: "brand_admin", base: "/brand-kit", title: "Update the Brand Kit",
    hint: "Add a rule, fact or term. The very next review is checked against it.", here: "Press Add source, fill in a term, and save." },
  { id: "insights", role: "manager", base: "/insights", title: "See the Insights",
    hint: "The most common findings, and the rules people keep disputing.", here: "Look it over. This step ticks itself off." },
];

/**
 * Demo-only guide. It sits at the top of the page in normal flow, so it never covers a button.
 * It shows the one step to do next, takes you there (switching role if needed), and ticks steps off as you do them.
 */
export function TourBar() {
  const demo = useIsDemo();
  const user = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const reviews = useReviews();
  const { done, open } = tourStore.use();
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!demo || !user || !open) return null;

  const doneCount = STEPS.filter(s => done[s.id]).length;
  const current = STEPS.find(s => !done[s.id]);

  const target = (s: Step): string => {
    if (s.id === "submit") return "/reviews/new?sample=risky";
    if (s.id === "approve") return "/approvals";
    if (s.id === "escalation") { const e = reviews.find(r => r.openEscalation?.to_role === "brand_admin"); return e ? `/reviews/${e.id}` : "/approvals"; }
    if (s.id === "kit") return "/brand-kit";
    if (s.id === "insights") return "/insights";
    const mine = user.role === "creator" ? reviews.find(r => r.status === "Needs attention" && r.findings.some(f => f.status === "Open")) : undefined;
    return mine ? `/reviews/${mine.id}` : "/dashboard";
  };
  const isHere = (s: Step) => pathname.startsWith(s.base) && !(s.base === "/reviews/" && pathname.startsWith("/reviews/new"));
  async function go(s: Step) {
    setBusy(true);
    try { if (user && user.role !== s.role) await switchDemoRole(s.role); router.push(target(s)); }
    finally { setBusy(false); }
  }

  if (!current) {
    return (
      <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-success/25 bg-success/10 px-4 py-3 print:hidden">
        <p className="text-sm text-ink"><span className="font-bold">You have seen the whole workflow.</span> Use the role menu at the top to explore any view, or sign in with a registered account.</p>
        <button onClick={() => setTourOpen(false)} aria-label="Close tour" className="rounded-lg p-1.5 text-muted transition hover:bg-surface hover:text-ink"><X size={16} /></button>
      </div>
    );
  }

  const here = user.role === current.role && isHere(current);
  const idx = STEPS.indexOf(current) + 1;
  return (
    <section aria-label="Guided tour" className="mb-6 overflow-hidden rounded-2xl border border-brand/25 bg-brand/5 print:hidden">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5">
        <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-ink sm:flex"><Compass size={19} /></span>
        <div className="min-w-0 flex-1 basis-72">
          <div className="text-[11px] font-bold uppercase tracking-wider text-brand">Guided tour · step {idx} of {STEPS.length} · as {ROLE_LABEL[current.role]}</div>
          <div className="mt-0.5 text-[15px] font-bold text-ink">{current.title}</div>
          <p className="mt-0.5 text-xs leading-5 text-muted">{here ? <span className="font-semibold text-ink">Do this now: {current.here}</span> : current.hint}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {!here && (
            <button onClick={() => go(current)} disabled={busy}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-brand-ink shadow-glow transition hover:bg-brand-strong disabled:opacity-60">
              {user.role !== current.role ? `Switch to ${ROLE_LABEL[current.role]} and go` : "Take me there"} <ArrowRight size={15} />
            </button>
          )}
          <button onClick={() => setAll(a => !a)} aria-expanded={all} className="inline-flex h-10 items-center gap-1 rounded-xl px-3 text-xs font-semibold text-muted transition hover:bg-surface hover:text-ink">
            All steps <ChevronDown size={14} className={cn("transition", all && "rotate-180")} />
          </button>
          <button onClick={() => setTourOpen(false)} aria-label="Hide tour" className="rounded-lg p-2 text-muted transition hover:bg-surface hover:text-ink"><X size={16} /></button>
        </div>
      </div>
      <div className="h-1 bg-brand/10"><div className="h-full bg-brand transition-all duration-500" style={{ width: `${(doneCount / STEPS.length) * 100}%` }} /></div>
      {all && (
        <ol className="grid gap-1 border-t border-brand/15 bg-surface p-2 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <button onClick={() => go(s)} disabled={busy} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-soft">
                <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold", done[s.id] ? "border-success bg-success text-brand-ink" : "border-line text-muted")}>
                  {done[s.id] ? <Check size={12} /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className={cn("block truncate text-[13px] font-semibold", done[s.id] ? "text-muted line-through decoration-muted/40" : "text-ink")}>{s.title}</span>
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">{ROLE_LABEL[s.role]}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
