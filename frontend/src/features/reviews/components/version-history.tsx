"use client";
import { useMemo, useState } from "react";
import { Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useAsync } from "@/lib/use-api";
import { diffWords } from "../lib/diff";

/** Every saved text of the draft, and what changed between any two of them. */
export function VersionHistory({ reviewId, refreshKey }: { reviewId: string; refreshKey: string }) {
  const { data, loading, error } = useAsync(() => api.getVersions(reviewId), true, refreshKey);
  const [pickedFrom, setFrom] = useState<number | null>(null);
  const [pickedTo, setTo] = useState<number | null>(null);
  const versions = data ?? [];
  const latest = versions[versions.length - 1]?.number ?? 1;
  const from = Math.min(pickedFrom ?? 1, latest), to = Math.min(pickedTo ?? latest, latest);
  const a = versions.find(v => v.number === from), b = versions.find(v => v.number === to);
  const parts = useMemo(() => (a && b ? diffWords(a.content, b.content) : null), [a, b]);

  if (loading && !data) return <div className="p-5"><Skeleton className="h-24" /></div>;
  if (error) return <p className="p-5 text-xs text-danger">{error}</p>;
  if (versions.length < 2) return <p className="p-5 text-sm leading-6 text-muted">No edits yet. When a finding is fixed, the new wording is saved as a version, and you can compare it with what was submitted here.</p>;

  return (
    <div className="p-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        Compare
        <Select value={from} onChange={e => setFrom(Number(e.target.value))} aria-label="From version" className="h-9 w-auto text-xs">
          {versions.map(v => <option key={v.number} value={v.number}>Version {v.number}{v.number === 1 ? " (submitted)" : ""}</option>)}
        </Select>
        with
        <Select value={to} onChange={e => setTo(Number(e.target.value))} aria-label="To version" className="h-9 w-auto text-xs">
          {versions.map(v => <option key={v.number} value={v.number}>Version {v.number}{v.number === latest ? " (current)" : ""}</option>)}
        </Select>
      </div>

      <div className="mt-4 whitespace-pre-wrap rounded-xl border border-line bg-soft/60 p-4 text-[15px] leading-7 text-ink" aria-label="Changes between the two versions">
        {from === to && <span className="text-sm text-muted">Pick two different versions to see what changed.</span>}
        {from !== to && parts === null && <span className="text-sm text-muted">These drafts are too different to compare here. Version {to}: {b?.content}</span>}
        {from !== to && parts?.map((p, i) =>
          p.type === "same" ? <span key={i}>{p.text}</span>
            : p.type === "add" ? <ins key={i} className="rounded bg-success/15 px-0.5 text-ink no-underline">{p.text}</ins>
              : <del key={i} className="rounded bg-danger/15 px-0.5 text-ink/70 decoration-danger/60">{p.text}</del>)}
      </div>

      <ol className="mt-4 space-y-2">
        {versions.map(v => (
          <li key={v.number} className="flex items-start gap-3 text-xs">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-soft font-bold text-muted">{v.number}</span>
            <span className="text-muted"><span className="font-semibold text-ink">{v.created_by ?? "System"}</span> · {formatDateTime(v.created_at)}{v.reason && v.reason !== "submitted" ? ` · ${v.reason}` : v.number === 1 ? " · submitted" : ""}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
