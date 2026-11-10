/**
 * Frontend mirror of the fixed Greenlight API contract in PROJECT.md.
 * Keep these wire shapes unchanged; UI-specific models belong in feature adapters.
 */
export type UserRole = "creator" | "manager" | "reviewer" | "brand_admin";
export type ReviewApiStatus = "draft" | "scanned" | "resolving" | "in_review" | "approved" | "changes_requested";
export type SourceKind = "guideline" | "fact" | "term" | "asset";
export type FindingType = "unsupported_claim" | "contradicted_claim" | "terminology" | "tone" | "accessibility" | "visual";
export type ApiSeverity = "high" | "medium" | "low";
export type FindingMethod = "rule_based" | "ai_assisted";
export type FindingAction = "accepted" | "edited" | "disputed";

export interface ApiUser {
  id: string;
  name: string;
  role: UserRole;
  workspace_id: string;
}

export interface LoginRequest { email: string; password: string }
export interface LoginResponse { access_token: string; token_type: "bearer"; user: ApiUser }

export interface BrandSource {
  id: string;
  kind: SourceKind;
  title: string;
  text: string;
  version: string;
  status: string;
}
export interface CreateBrandSourceRequest { kind: SourceKind; title: string; text: string }

export interface ReviewListItem {
  id: string;
  title: string;
  creator: string;
  status: ReviewApiStatus;
  finding_count: number;
  updated_at: string;
}
export interface CreateReviewRequest { title: string; content: string; intent_note: string }
export interface CreateReviewResponse { id: string; status: ReviewApiStatus; finding_count: number }
export interface ReviewDetail {
  id: string;
  title: string;
  content: string;
  status: ReviewApiStatus;
  creator: string;
  brand_kit_version: string;
  created_at: string;
  updated_at: string;
}

export interface FindingSpan { start: number; end: number; text: string }
export interface FindingSource { kind: SourceKind; id: string; version: string }
export type FactMatch = { id: string; version?: string; text?: string } | null;
export interface FindingSuggestion { text: string; fact_id: string | null; applied: boolean }
export interface FindingDecision {
  action: FindingAction;
  reason: string;
  actor: string;
}
export interface ApiFinding {
  finding_id: string;
  type: FindingType;
  severity: ApiSeverity;
  span: FindingSpan;
  source: FindingSource | null;
  fact_match: FactMatch;
  reason: string;
  confidence: number;
  method: FindingMethod;
  suggestion: FindingSuggestion | null;
  decision: FindingDecision | null;
}
export interface PatchFindingRequest { action: FindingAction; reason: string; edited_text: string | null }
export interface PatchFindingResponse { finding_id: string; decision: FindingDecision }

export interface CreateCommentRequest { text: string; finding_id?: string | null }
export interface CommentResponse { id: string; author: string; role: UserRole; text: string; created_at: string; finding_id: string | null }

export type ActivityEventType =
  | "review_submitted" | "scan_completed" | "content_edited" | "finding_decision"
  | "comment_added" | "status_changed" | "approved" | "changes_requested";
export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  at: string;
  /** null = the system (the automated check). */
  actor: { id: string; name: string; role: UserRole } | null;
  /** Ready to display. */
  summary: string;
  reason: string;
  detail: { quote?: string; text?: string; finding_id?: string; [key: string]: unknown };
  review_id: string | null;
  /** Filled in only by the workspace-wide feed. */
  review_title: string | null;
}
export interface VersionResponse { number: number; content: string; reason: string; created_by: string | null; created_at: string }
export interface WorkflowNoteRequest { note: string }
export interface WorkflowResponse { id: string; status: ReviewApiStatus }
export interface InsightsSummary {
  reviewed_this_month: number;
  needs_attention: number;
  awaiting_approval: number;
  approved_this_month: number;
  top_issues: Array<{ type: FindingType; count: number }>;
}
export interface InsightGap { source_id: string; title: string; dispute_count: number; note: string }
export interface AiDisclosure {
  review_id: string;
  steps: Array<{ step: string; used_ai: boolean; model?: string; data_sent?: string }>;
}
