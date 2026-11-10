"use client";
import { useState } from "react";
import { CheckCheck, MessageSquareWarning, ShieldCheck } from "lucide-react";
import { Button, Card, CardHeader, Textarea } from "@/components/ui";
import { approvalBlockerCount } from "../lib/metrics";
import type { Review } from "../types";

type Props = {
  review: Review;
  /** Only reviewers can decide; everyone else sees the state read-only. */
  canDecide: boolean;
  busy?: boolean;
  /** Why the reviewer cannot decide right now (an open escalation, or it is assigned to someone else). */
  blocked?: string;
  onApprove: (note: string) => void;
  onRequestChanges: (note: string) => void;
};

export function ReviewOutcome({ review, canDecide, busy, blocked, onApprove, onRequestChanges }: Props) {
  const [note, setNote] = useState("");
  const blockers = approvalBlockerCount(review);
  const approved = review.status === "Approved";
  const awaiting = review.status === "In review";
  return (
    <Card>
      <CardHeader icon={ShieldCheck} title="Review outcome" description="Greenlight surfaces conflicts. A person owns the publication decision." />
      <div className="p-5">
        {approved ? (
          <div className="flex items-center gap-3 rounded-xl border border-success/25 bg-success/10 p-4 text-sm font-semibold text-success"><CheckCheck size={18} /> Approved for publication</div>
        ) : canDecide && awaiting && blocked ? (
          <p className="rounded-xl border border-warning/25 bg-warning/10 p-4 text-sm leading-6 text-ink/85">{blocked}</p>
        ) : canDecide && awaiting ? (
          <div className="space-y-3">
            <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} aria-label="Decision note" placeholder="Note for the creator (required when requesting changes)" />
            <div className="grid gap-2 sm:grid-cols-2">
              <Button loading={busy} onClick={() => onApprove(note)} disabled={blockers > 0}><CheckCheck size={15} /> Approve content</Button>
              <Button variant="secondary" disabled={busy || !note.trim()} onClick={() => onRequestChanges(note)}><MessageSquareWarning size={15} /> Request changes</Button>
            </div>
          </div>
        ) : (
          <p className="rounded-xl bg-soft p-4 text-sm leading-6 text-muted">
            {review.status === "Changes requested" ? "Changes were requested. The creator revises the findings, then the review returns to a reviewer."
              : awaiting ? "Waiting for a reviewer to approve or request changes."
              : "The creator resolves every finding, then a reviewer makes the final decision."}
          </p>
        )}
        {blockers > 0 && !approved && <p className="mt-3 text-xs text-warning">{blockers} finding{blockers === 1 ? "" : "s"} still need{blockers === 1 ? "s" : ""} an edit or a “not applicable” reason before this can be approved.</p>}
      </div>
    </Card>
  );
}
