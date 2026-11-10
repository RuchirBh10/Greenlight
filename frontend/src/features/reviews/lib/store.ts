"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { BrandSource } from "@/types/contract";
import { api, getMode, isDemo } from "@/lib/api";
import { resetMockDb } from "@/lib/mockData";
import { createPersistentStore } from "@/lib/persistent-store";
import { onSessionChange, getSessionUser } from "@/lib/session";
import { reviewFromApi, type ReviewMeta } from "./adapters";
import { markTour, resetTour } from "@/features/tour/store";
import { canApprove } from "./metrics";
import type { FindingStatus, Review, ReviewInput } from "../types";

/**
 * Review repository. Every read and write goes through lib/api.ts (mock or live, one switch).
 * The screens read this store; they never call fetch.
 *
 * Browser-only extras (the API has no field for them yet): channel / depth / intent, the submitted copy, and the
 * wording before an edit. History, comments and versions are read from the server by the screens that show them.
 */
type State = { reviews: Review[]; loaded: boolean; error: string };
const EMPTY: Review[] = [];
const SERVER_STATE: State = { reviews: EMPTY, loaded: false, error: "" };
let state: State = SERVER_STATE;
let loading = false;
let sources = new Map<string, BrandSource>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
function set(next: Partial<State>) { state = { ...state, ...next }; listeners.forEach(l => l()); }

const metaStore = createPersistentStore<Record<string, ReviewMeta>>("greenlight-review-meta-v1", () => ({}), {});
const dataSource = (): Review["source"] => (isDemo() ? "local-demo" : "api");
/** Local records are namespaced by mode so demo and live reviews (which share id formats) never mix. */
const key = (id: string) => `${getMode()}:${id}`;

async function fetchReview(id: string): Promise<Review | null> {
  try {
    const [detail, findings] = await Promise.all([api.getReview(id), api.getFindings(id)]);
    return reviewFromApi(detail, findings, sources, metaStore.read()[key(id)], dataSource());
  } catch { return null; }
}
async function refreshOne(id: string): Promise<Review | null> {
  const fresh = await fetchReview(id);
  if (!fresh) return null;
  const exists = state.reviews.some(r => r.id === id);
  set({ reviews: exists ? state.reviews.map(r => (r.id === id ? fresh : r)) : [fresh, ...state.reviews] });
  return fresh;
}

/** A background load can finish after a newer change. Never let it overwrite something fresher than what it fetched. */
function mergeLoaded(fetched: Review[]): Review[] {
  const current = new Map(state.reviews.map(r => [r.id, r]));
  const merged = fetched.map(r => { const c = current.get(r.id); return c && +new Date(c.updatedAt) > +new Date(r.updatedAt) ? c : r; });
  const known = new Set(fetched.map(r => r.id));
  return [...state.reviews.filter(r => !known.has(r.id)), ...merged];
}

async function load() {
  if (loading) return;
  loading = true;
  try {
    const [list, kit] = await Promise.all([api.getReviews(), api.getBrandSources().catch(() => [] as BrandSource[])]);
    sources = new Map(kit.map(s => [s.id, s]));
    const reviews = (await Promise.all(list.map(item => fetchReview(item.id)))).filter((r): r is Review => r !== null);
    set({ reviews: mergeLoaded(reviews), loaded: true, error: "" });
  } catch (e) {
    set({ loaded: true, error: e instanceof Error ? e.message : "Could not load reviews." });
  } finally { loading = false; }
}
function ensureLoaded() { if (getSessionUser() && !state.loaded && !loading) void load(); }
/** Retry after an error, or refresh after something changed elsewhere. */
export function reloadReviews() { state = { reviews: state.reviews, loaded: false, error: "" }; listeners.forEach(l => l()); ensureLoaded(); }

if (typeof window !== "undefined") {
  onSessionChange(() => { state = { reviews: EMPTY, loaded: false, error: "" }; loading = false; listeners.forEach(l => l()); ensureLoaded(); });
}

function useEnsure() { useEffect(() => { ensureLoaded(); }, []); }
export function useReviews(): Review[] { useEnsure(); return useSyncExternalStore(subscribe, () => state.reviews, () => EMPTY); }
export function useReview(id: string): Review | undefined { useEnsure(); return useSyncExternalStore(subscribe, () => state.reviews.find(r => r.id === id), () => undefined); }
/** False until the first load finishes (server render included). Use it to show skeletons. */
export function useReviewsLoaded(): boolean { useEnsure(); return useSyncExternalStore(subscribe, () => state.loaded, () => false); }
export function useReviewsError(): string { return useSyncExternalStore(subscribe, () => state.error, () => ""); }

/** Clears this browser's records for the current mode. In demo it also restores the sample workspace; the live backend is never touched. */
export function resetReviews(mode = getMode()) {
  const keep = <T,>(all: Record<string, T>) => Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith(`${mode}:`)));
  metaStore.update(keep);
  if (mode === "demo") { resetMockDb(); resetTour(); }
  reloadReviews();
}

export async function createReview(input: ReviewInput): Promise<Review> {
  const created = await api.createReview({ title: input.title, content: input.content, intent_note: input.intent ?? "" });
  metaStore.update(m => ({ ...m, [key(created.id)]: { channel: input.channel, mode: input.mode, intent: input.intent, original: input.content } }));
  markTour("submit");
  const review = await refreshOne(created.id);
  if (!review) throw new Error("The review was created but could not be loaded. Open it from the reviews list.");
  return review;
}

/** Confirm a finding as valid, or dispute it. Disputing needs a reason (the server requires one too). */
export async function decideFinding(id: string, findingId: string, status: Extract<FindingStatus, "Accepted" | "Disputed">, reason = "") {
  const f = state.reviews.find(r => r.id === id)?.findings.find(x => x.id === findingId);
  await api.updateFinding(findingId, { action: status === "Accepted" ? "accepted" : "disputed", reason: reason.trim(), edited_text: null });
  await refreshOne(id);
  if (state.reviews.find(r => r.id === id)?.status === "In review") markTour("resolve");
}

/** Replaces the flagged phrase through the API (the server rewrites the draft and records a new version). */
export async function rewriteFinding(id: string, findingId: string, replacement: string, via: "suggestion" | "manual") {
  const f = state.reviews.find(r => r.id === id)?.findings.find(x => x.id === findingId);
  if (!f || !replacement.trim()) return;
  await api.updateFinding(findingId, { action: "edited", reason: via === "suggestion" ? "Applied the suggested wording." : "Replaced the flagged wording.", edited_text: replacement.trim() });
  metaStore.update(m => {
    const cur = m[key(id)] ?? {};
    return { ...m, [key(id)]: { ...cur, originals: { ...cur.originals, [findingId]: cur.originals?.[findingId] ?? f.quote } } };
  });
  await refreshOne(id);
  if (state.reviews.find(r => r.id === id)?.status === "In review") markTour("resolve");
}

/** Reviewer only (the server enforces it). Approval is blocked while any finding is open or only confirmed. */
export async function approveReview(id: string, note = ""): Promise<boolean> {
  const review = state.reviews.find(r => r.id === id);
  if (!review || !canApprove(review)) return false;
  await api.approveReview(id, { note });
  markTour("approve");
  await refreshOne(id);
  return true;
}
export async function requestChanges(id: string, note: string) {
  await api.requestChanges(id, { note });
  await refreshOne(id);
}

/** Manager or brand admin. Pass null to remove the assignee. Once set, only that reviewer can decide. */
export async function assignReview(id: string, reviewerId: string | null, note = "") {
  await api.assignReview(id, { reviewer_id: reviewerId, note });
  await refreshOne(id);
}
/** Reviewer only. Pauses decisions until the person it is sent to resolves it. */
export async function escalateReview(id: string, toRole: "manager" | "brand_admin", reason: string) {
  await api.escalateReview(id, { to_role: toRole, reason });
  await refreshOne(id);
}
/** Only the role the escalation was sent to can resolve it. */
export async function resolveEscalation(id: string, escalationId: string, resolution: string) {
  await api.resolveEscalation(id, escalationId, { resolution });
  markTour("escalation");
  await refreshOne(id);
}
