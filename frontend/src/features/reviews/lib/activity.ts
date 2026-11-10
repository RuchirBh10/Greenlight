import type { ActivityEventType } from "@/types/contract";
import type { AuditKind } from "../types";

/** Groups the server's event types into the few categories the timeline icons and the history filter use. */
const KIND: Record<ActivityEventType, AuditKind> = {
  review_submitted: "submitted",
  scan_completed: "analysis",
  content_edited: "edit",
  finding_decision: "finding",
  comment_added: "comment",
  status_changed: "status",
  approved: "status",
  changes_requested: "status",
};
export const kindOf = (type: ActivityEventType): AuditKind => KIND[type] ?? "status";
