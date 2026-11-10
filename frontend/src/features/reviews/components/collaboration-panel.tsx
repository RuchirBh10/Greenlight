"use client";
import { useEffect, useState } from "react";
import { Bot, GitCompare, History, MessageSquare } from "lucide-react";
import { Card, Skeleton } from "@/components/ui";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { markTour } from "@/features/tour/store";
import { useAsync } from "@/lib/use-api";
import type { Review } from "../types";
import { AiDisclosureCard } from "./ai-disclosure-card";
import { AuditTimeline } from "./audit-timeline";
import { ReviewDiscussion } from "./review-discussion";
import { VersionHistory } from "./version-history";

type Tab = "discussion" | "activity" | "changes" | "ai";
const TABS: TabItem<Tab>[] = [
  { id: "discussion", label: "Discussion", icon: MessageSquare },
  { id: "activity", label: "Activity", icon: History },
  { id: "changes", label: "Changes", icon: GitCompare },
  { id: "ai", label: "AI use", icon: Bot },
];

function ActivityTab({ reviewId, refreshKey }: { reviewId: string; refreshKey: string }) {
  const { data, loading, error } = useAsync(() => api.getActivity(reviewId), true, refreshKey);
  useEffect(() => { markTour("audit"); }, []);
  if (loading && !data) return <div className="p-5"><Skeleton className="h-24" /></div>;
  if (error) return <p className="p-5 text-xs text-danger">{error}</p>;
  return (
    <>
      <AuditTimeline events={data ?? []} />
      <p className="border-t border-line px-5 py-3 text-xs leading-5 text-muted">Every action is recorded with who did it, when, and why. Nothing here can be edited.</p>
    </>
  );
}

/** Everything about how a review was handled, in one place: the conversation, the audit trail, what changed, and AI use. */
export function CollaborationPanel({ review, onSelectFinding }: { review: Review; onSelectFinding: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>("discussion");
  const [bump, setBump] = useState(0);
  // Panels reload when the review moves (updatedAt changes) or when this person posts a comment.
  const refreshKey = `${review.updatedAt}:${bump}`;
  return (
    <Card className="overflow-hidden">
      <Tabs items={TABS} value={tab} onChange={setTab} />
      {tab === "discussion" && <ReviewDiscussion reviewId={review.id} findings={review.findings} refreshKey={refreshKey} onChanged={() => setBump(n => n + 1)} onSelectFinding={onSelectFinding} />}
      {tab === "activity" && <ActivityTab reviewId={review.id} refreshKey={refreshKey} />}
      {tab === "changes" && <VersionHistory reviewId={review.id} refreshKey={refreshKey} />}
      {tab === "ai" && <AiDisclosureCard reviewId={review.id} bare />}
    </Card>
  );
}
