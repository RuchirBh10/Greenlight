"use client";
import { useState } from "react";
import { MessageSquare, Send } from "lucide-react";
import { Avatar, Badge, Button, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/session";
import { useAsync } from "@/lib/use-api";
import type { Finding } from "../types";

type Props = { reviewId: string; findings: Finding[]; refreshKey: string; onChanged: () => void; onSelectFinding: (id: string) => void };

/** The review's conversation. Anyone who can open the review can write here; a comment may point at one finding. */
export function ReviewDiscussion({ reviewId, findings, refreshKey, onChanged, onSelectFinding }: Props) {
  const { toast } = useToast();
  const thread = useAsync(() => api.getComments(reviewId), true, refreshKey);
  const [text, setText] = useState("");
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);
  const quoteOf = (id: string | null) => findings.find(f => f.id === id)?.quote;

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await api.addComment(reviewId, { text: text.trim(), finding_id: about || null });
      setText(""); setAbout("");
      onChanged();
    } catch (e) { toast(e instanceof Error ? e.message : "Could not post the comment.", "warning"); }
    finally { setBusy(false); }
  }

  const comments = thread.data ?? [];
  return (
    <div className="p-5">
      {thread.loading && !thread.data && <Skeleton className="h-16" />}
      {thread.error && <p className="text-xs text-danger">{thread.error}</p>}
      {thread.data && !comments.length && (
        <div className="flex items-center gap-3 rounded-xl bg-soft p-4 text-sm text-muted"><MessageSquare size={16} className="shrink-0" />No comments yet. Ask a question or leave context for the next person.</div>
      )}
      <ul className="space-y-4">
        {comments.map(c => (
          <li key={c.id} className="flex gap-3">
            <Avatar name={c.author} size={30} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-sm font-semibold text-ink">{c.author}</span>
                <Badge>{ROLE_LABEL[c.role]}</Badge>
                <span className="text-xs text-muted">{relativeTime(c.created_at)}</span>
              </div>
              {c.finding_id && quoteOf(c.finding_id) && (
                <button onClick={() => onSelectFinding(c.finding_id!)} className="mt-1 max-w-full truncate rounded-md bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning hover:bg-warning/20">On “{quoteOf(c.finding_id)}”</button>
              )}
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink/90">{c.text}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-5 space-y-2 border-t border-line pt-4">
        <Textarea rows={2} value={text} onChange={e => setText(e.target.value)} aria-label="Write a comment" placeholder="Write a comment…"
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void send(); }} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Select value={about} onChange={e => setAbout(e.target.value)} aria-label="Comment about" className="h-9 max-w-[220px] text-xs">
            <option value="">About the whole review</option>
            {findings.map(f => <option key={f.id} value={f.id}>About “{f.quote.length > 28 ? `${f.quote.slice(0, 28)}…` : f.quote}”</option>)}
          </Select>
          <Button size="sm" loading={busy} disabled={!text.trim()} onClick={send}><Send size={13} /> Comment</Button>
        </div>
      </div>
    </div>
  );
}
