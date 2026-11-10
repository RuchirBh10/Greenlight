import { Bot, CheckCircle2, FilePlus2, Gavel, MessageSquare, Pencil, UserCheck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/session";
import type { ActivityEvent } from "@/types/contract";
import { kindOf } from "../lib/activity";
import type { AuditKind } from "../types";

export const auditMeta: Record<AuditKind, { icon: LucideIcon; tone: string; label: string }> = {
  submitted: { icon: FilePlus2, tone: "bg-brand/10 text-brand", label: "Submission" },
  analysis: { icon: Bot, tone: "bg-info/10 text-info", label: "Analysis" },
  finding: { icon: Gavel, tone: "bg-warning/10 text-warning", label: "Decision" },
  edit: { icon: Pencil, tone: "bg-success/10 text-success", label: "Edit" },
  comment: { icon: MessageSquare, tone: "bg-info/10 text-info", label: "Comment" },
  routing: { icon: UserCheck, tone: "bg-warning/10 text-warning", label: "Routing" },
  status: { icon: CheckCircle2, tone: "bg-success/10 text-success", label: "Status" },
};

export const actorLabel = (e: ActivityEvent) => (e.actor ? `${e.actor.name} · ${ROLE_LABEL[e.actor.role]}` : "Greenlight (automated)");

/** What a person needs to understand an event at a glance: what happened, who, why, and the words they wrote. */
export function EventBody({ e }: { e: ActivityEvent }) {
  return (
    <>
      <p className="text-sm leading-5 text-ink">{e.summary}</p>
      {e.type === "comment_added" && e.detail.text && (
        <p className="mt-1.5 rounded-lg border-l-2 border-info/40 bg-soft px-3 py-2 text-[13px] leading-5 text-ink/80">{e.detail.text}</p>
      )}
      {e.reason && e.type !== "comment_added" && <p className="mt-1 text-[13px] leading-5 text-muted">Reason: {e.reason}</p>}
    </>
  );
}

/** One review's history, newest first. */
export function AuditTimeline({ events }: { events: ActivityEvent[] }) {
  const list = [...events].reverse();
  if (!list.length) return <p className="p-5 text-sm text-muted">No activity yet.</p>;
  return (
    <ol className="p-5">
      {list.map((e, i) => {
        const { icon: Icon, tone } = auditMeta[kindOf(e.type)];
        return (
          <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
            {i < list.length - 1 && <span className="absolute left-[15px] top-8 h-[calc(100%-26px)] w-px bg-line" />}
            <span className={cn("z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", tone)}><Icon size={14} /></span>
            <div className="min-w-0 flex-1 pt-0.5">
              <EventBody e={e} />
              <p className="mt-1 text-xs text-muted">{actorLabel(e)} · {formatDateTime(e.at)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
