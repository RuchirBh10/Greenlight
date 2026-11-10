"use client";
import { Bot } from "lucide-react";
import { Badge, Card, CardHeader, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/use-api";

const LABEL: Record<string, string> = { rules: "Rule checks", retrieve: "Source retrieval", judge: "AI judgement" };

/** What was and was not sent to an AI service for this review. Counts only, never the draft text. */
export function AiDisclosureCard({ reviewId, bare = false }: { reviewId: string; bare?: boolean }) {
  const { data, error, loading } = useAsync(() => api.getAiDisclosure(reviewId));
  const body = (
    <div className="space-y-3 p-5">
      {loading && <Skeleton className="h-16" />}
      {error && <p className="text-xs text-muted">The AI-use record could not be loaded. {error}</p>}
      {data?.steps.map((s, i) => (
        <div key={`${s.step}-${i}`} className="flex items-start justify-between gap-3 border-b border-line pb-3 last:border-0 last:pb-0">
          <div>
            <div className="text-sm font-semibold text-ink">{LABEL[s.step] ?? s.step}</div>
            <p className="mt-0.5 text-xs leading-5 text-muted">{s.used_ai ? `${s.model ? `${s.model} · ` : ""}${s.data_sent ?? "data sent"}` : s.data_sent ?? "No AI used"}</p>
          </div>
          <Badge tone={s.used_ai ? "warning" : "success"}>{s.used_ai ? "AI used" : "No AI"}</Badge>
        </div>
      ))}
    </div>
  );
  if (bare) return body;
  return (
    <Card>
      <CardHeader icon={Bot} title="AI use for this review" description="What was and was not sent to an AI service" />
      {body}
    </Card>
  );
}
